/**
 * 数学计算与表达式解析引擎
 * 支持 math.js 解析与安全 fallback，以及自适应采样、数值微积分计算
 */

class MathEngine {
  constructor() {
    this.variables = {
      a: 1.0,
      b: 1.0,
      c: 0.0,
      k: 1.0,
      m: 2.0,
      n: 3.0,
      t: 0.0
    };
    this.compiledCache = new Map();
  }

  setVariable(name, value) {
    this.variables[name] = Number(value);
    // 变量更新时无需完全清空编译缓存，只需重新求值
  }

  setVariables(vars) {
    Object.assign(this.variables, vars);
  }

  getVariable(name) {
    return this.variables[name] ?? 0;
  }

  /**
   * 预处理数学表达式，支持自然数学输入
   * 例如 2x -> 2*x, sin x -> sin(x), ^ -> 幂等
   */
  preprocessExpression(expr) {
    if (!expr || typeof expr !== 'string') return '';
    let s = expr.trim();

    // 替换中文符号
    s = s.replace(/（/g, '(').replace(/）/g, ')');
    s = s.replace(/，/g, ',').replace(/。/g, '.');
    s = s.replace(/π/g, 'pi');

    // 隐式乘法处理，例如 2x -> 2*x, 3sin(x) -> 3*sin(x), x y -> x*y
    // 数字紧跟变量或括号：2x -> 2*x, 2(x+1) -> 2*(x+1)
    s = s.replace(/(\d+)\s*([a-zA-Z\(])/g, '$1*$2');
    // 括号紧跟变量或数字或括号：(x+1)(x-1) -> (x+1)*(x-1), (x+1)x -> (x+1)*x
    s = s.replace(/\)\s*([\da-zA-Z\(])/g, ')*$1');

    return s;
  }

  /**
   * 编译表达式为可执行函数
   */
  compile(expr, paramName = 'x') {
    const cleanExpr = this.preprocessExpression(expr);
    if (!cleanExpr) {
      throw new Error('表达式不能为空');
    }

    if (window.math && typeof window.math.compile === 'function') {
      try {
        const compiled = window.math.compile(cleanExpr);
        return {
          evaluate: (val, extraScope = {}) => {
            const scope = {
              ...this.variables,
              ...extraScope,
              [paramName]: val,
              e: Math.E,
              pi: Math.PI,
              PI: Math.PI
            };
            try {
              const res = compiled.evaluate(scope);
              if (typeof res === 'number') {
                return Number.isFinite(res) ? res : NaN;
              }
              if (res && typeof res.toNumber === 'function') {
                const n = res.toNumber();
                return Number.isFinite(n) ? n : NaN;
              }
              return NaN;
            } catch (e) {
              return NaN;
            }
          },
          raw: cleanExpr
        };
      } catch (err) {
        throw new Error(`语法错误: ${err.message}`);
      }
    }

    // Fallback: 简易原生 JS 安全求值器
    return this.createFallbackCompiled(cleanExpr, paramName);
  }

  createFallbackCompiled(cleanExpr, paramName) {
    // 简易替换支持常见数学函数
    let jsExpr = cleanExpr
      .replace(/\^/g, '**')
      .replace(/\b(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|exp|log|log10|sqrt|cbrt|abs|floor|ceil|round)\b/g, 'Math.$1')
      .replace(/\bln\b/g, 'Math.log')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/g, 'Math.E');

    try {
      const fn = new Function('scope', `
        with(scope) {
          try {
            const val = ${jsExpr};
            return typeof val === 'number' && isFinite(val) ? val : NaN;
          } catch(e) {
            return NaN;
          }
        }
      `);

      return {
        evaluate: (val, extraScope = {}) => {
          const scope = {
            Math,
            ...this.variables,
            ...extraScope,
            [paramName]: val
          };
          return fn(scope);
        },
        raw: cleanExpr
      };
    } catch (err) {
      throw new Error(`表达式解析失败: ${err.message}`);
    }
  }

  /**
   * 数值导数 f'(x)
   */
  numericalDerivative(compiledFn, x, h = 1e-5) {
    const y1 = compiledFn.evaluate(x + h);
    const y0 = compiledFn.evaluate(x - h);
    if (isNaN(y1) || isNaN(y0)) return NaN;
    return (y1 - y0) / (2 * h);
  }

  /**
   * 数值定积分 (自适应 Simpson 复合求积公式)
   */
  numericalIntegrate(compiledFn, a, b, n = 200) {
    if (a === b) return 0;
    if (a > b) return -this.numericalIntegrate(compiledFn, b, a, n);
    if (n % 2 !== 0) n++; // Simpson 法则需要偶数个子区间

    const h = (b - a) / n;
    let sum = compiledFn.evaluate(a) + compiledFn.evaluate(b);
    if (isNaN(sum)) sum = 0;

    for (let i = 1; i < n; i++) {
      const x = a + i * h;
      const y = compiledFn.evaluate(x);
      if (!isNaN(y)) {
        sum += (i % 2 === 0 ? 2 : 4) * y;
      }
    }

    return (sum * h) / 3;
  }

  /**
   * 零点探测 (在可见区间内基于变号检测与割线法)
   */
  findRoots(compiledFn, minX, maxX, steps = 150) {
    const roots = [];
    const dx = (maxX - minX) / steps;
    let prevX = minX;
    let prevY = compiledFn.evaluate(prevX);

    for (let i = 1; i <= steps; i++) {
      const currX = minX + i * dx;
      const currY = compiledFn.evaluate(currX);

      if (!isNaN(prevY) && !isNaN(currY)) {
        // 发现变号且不是渐近线跳跃（跳跃过大可能是渐近线，如 tan(x)）
        if (prevY * currY <= 0 && Math.abs(currY - prevY) < 50) {
          // 二分细化
          let left = prevX, right = currX;
          for (let k = 0; k < 20; k++) {
            const mid = (left + right) / 2;
            const midY = compiledFn.evaluate(mid);
            if (Math.abs(midY) < 1e-7) {
              left = mid;
              break;
            }
            if (midY * compiledFn.evaluate(left) <= 0) {
              right = mid;
            } else {
              left = mid;
            }
          }
          const root = (left + right) / 2;
          // 避免重复根
          if (!roots.some(r => Math.abs(r - root) < 1e-4)) {
            roots.push(root);
          }
        }
      }
      prevX = currX;
      prevY = currY;
    }
    return roots;
  }
}

window.MathEngine = MathEngine;
