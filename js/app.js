/**
 * 应用程序主控制器
 * 负责状态流转、UI 交互、移动端抽屉与手势响应、预设加载与导出
 */

document.addEventListener('DOMContentLoaded', () => {
  const mathEngine = new MathEngine();
  const canvasElem = document.getElementById('graphCanvas');

  // 初始化绘图画布
  const graph = new GraphCanvas(canvasElem, mathEngine, {
    onViewChange: (bounds) => updateViewDisplay(bounds),
    onCursorMove: (cursor, closest) => updateCursorDisplay(cursor, closest)
  });

  // 全局调色盘
  const COLOR_PALETTE = [
    '#3b82f6', // 蓝
    '#ef4444', // 红
    '#10b981', // 绿
    '#f59e0b', // 琥珀黄
    '#8b5cf6', // 紫
    '#ec4899', // 粉
    '#06b6d4', // 青
    '#f97316'  // 橙
  ];

  // 经典预设列表
  const PRESETS = {
    'damped_wave': {
      name: '阻尼振动波 (Damped Wave)',
      functions: [
        { type: 'cartesian', expr: 'exp(-0.2 * x) * cos(3 * x)', color: '#3b82f6', width: 2.5, style: 'solid', visible: true },
        { type: 'cartesian', expr: 'exp(-0.2 * x)', color: '#94a3b8', width: 1.5, style: 'dashed', visible: true },
        { type: 'cartesian', expr: '-exp(-0.2 * x)', color: '#94a3b8', width: 1.5, style: 'dashed', visible: true }
      ],
      vars: { a: 1, k: 3 },
      center: { x: 4, y: 0 },
      scale: 35
    },
    'dynamic_sine': {
      name: '动态调谐正弦波 (配合滑块动画)',
      functions: [
        { type: 'cartesian', expr: 'a * sin(k * x + t)', color: '#3b82f6', width: 3, style: 'solid', visible: true },
        { type: 'cartesian', expr: 'a * cos(k * x + t)', color: '#10b981', width: 2, style: 'dashed', visible: true }
      ],
      vars: { a: 2, k: 1, t: 0 },
      center: { x: 0, y: 0 },
      scale: 45
    },
    'gaussian': {
      name: '高斯正态分布曲线 (钟形曲线)',
      functions: [
        { type: 'cartesian', expr: '(1 / sqrt(2 * pi)) * exp(-0.5 * x^2)', color: '#8b5cf6', width: 3, style: 'solid', visible: true, integral: { enabled: true, from: -1.96, to: 1.96, color: 'rgba(139, 92, 246, 0.25)' } }
      ],
      vars: {},
      center: { x: 0, y: 0.3 },
      scale: 100
    },
    'heart_polar': {
      name: '笛卡尔心形线 (极坐标)',
      functions: [
        { type: 'polar', expr: '2 - 2 * sin(theta)', color: '#ef4444', width: 3, style: 'solid', visible: true, domain: { min: 0, max: 6.28318 } }
      ],
      vars: {},
      center: { x: 0, y: -0.5 },
      scale: 70,
      gridMode: 'polar'
    },
    'lissajous': {
      name: '利萨如三维振动轨迹 (参数方程)',
      functions: [
        { type: 'parametric', exprX: '3 * sin(3 * t)', exprY: '3 * cos(2 * t)', color: '#f59e0b', width: 2.5, style: 'solid', visible: true, domain: { min: 0, max: 6.28318 } }
      ],
      vars: {},
      center: { x: 0, y: 0 },
      scale: 50
    },
    'butterfly': {
      name: '蝴蝶曲线 (极坐标精妙曲线)',
      functions: [
        { type: 'polar', expr: 'exp(cos(theta)) - 2 * cos(4 * theta) + sin(theta / 12)^5', color: '#ec4899', width: 2, style: 'solid', visible: true, domain: { min: 0, max: 75.4 } }
      ],
      vars: {},
      center: { x: 0, y: 0 },
      scale: 65,
      gridMode: 'polar'
    },
    'polynomial_calculus': {
      name: '多项式与导数极值分析',
      functions: [
        { type: 'cartesian', expr: 'x^3 - 3*x', color: '#3b82f6', width: 2.5, style: 'solid', visible: true },
        { type: 'cartesian', expr: '3*x^2 - 3', color: '#ef4444', width: 2, style: 'dashed', visible: true }
      ],
      vars: {},
      center: { x: 0, y: 0 },
      scale: 50
    }
  };

  // 应用主状态
  let state = {
    functions: [
      {
        id: 'fn_1',
        type: 'cartesian',
        expr: 'sin(x)',
        color: '#3b82f6',
        width: 2.5,
        style: 'solid',
        visible: true,
        compiled: null,
        error: null,
        domain: null,
        integral: { enabled: false, from: 0, to: 3.14159, color: 'rgba(59, 130, 246, 0.25)' }
      },
      {
        id: 'fn_2',
        type: 'cartesian',
        expr: '0.2 * x^2 - 2',
        color: '#10b981',
        width: 2.5,
        style: 'solid',
        visible: true,
        compiled: null,
        error: null,
        domain: null,
        integral: { enabled: false, from: -2, to: 2, color: 'rgba(16, 185, 129, 0.25)' }
      }
    ],
    sliders: [
      { name: 'a', min: -5, max: 5, step: 0.1, value: 2.0, playing: false },
      { name: 'k', min: 0.1, max: 10, step: 0.1, value: 1.0, playing: false },
      { name: 't', min: 0, max: 12.56, step: 0.05, value: 0.0, playing: false }
    ],
    theme: 'dark'
  };

  // 初始化数学引擎变量
  state.sliders.forEach(s => {
    mathEngine.setVariable(s.name, s.value);
  });

  // 编译并同步函数
  function compileAllFunctions() {
    state.functions.forEach(fn => {
      try {
        if (fn.type === 'cartesian') {
          fn.compiled = mathEngine.compile(fn.expr, 'x');
        } else if (fn.type === 'polar') {
          fn.compiled = mathEngine.compile(fn.expr, 'theta');
        } else if (fn.type === 'parametric') {
          fn.compiledX = mathEngine.compile(fn.exprX || 't', 't');
          fn.compiledY = mathEngine.compile(fn.exprY || 't', 't');
          fn.compiled = fn.compiledX;
        }
        fn.error = null;
      } catch (err) {
        fn.compiled = null;
        fn.error = err.message;
      }
    });
    graph.setFunctions(state.functions);
  }

  // 渲染函数列表 DOM
  function renderFunctionList() {
    const listContainer = document.getElementById('functionList');
    listContainer.innerHTML = '';

    // 更新移动端底部胶囊按钮数量提示
    const fabLabel = document.getElementById('mobileFabLabel');
    if (fabLabel) {
      fabLabel.textContent = `函数与公式 (${state.functions.length})`;
    }

    state.functions.forEach((fn) => {
      const card = document.createElement('div');
      card.className = 'function-card';
      card.dataset.id = fn.id;

      let typeLabel = 'y = f(x)';
      if (fn.type === 'polar') typeLabel = 'r = f(θ)';
      if (fn.type === 'parametric') typeLabel = 'x(t), y(t)';

      card.innerHTML = `
        <div class="function-card-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" ${fn.visible ? 'checked' : ''} class="func-visibility-toggle" title="显示/隐藏">
            <span class="function-color-badge" style="background-color: ${fn.color};" title="点击更改颜色"></span>
            <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary);">${typeLabel}</span>
          </div>
          <div class="func-actions">
            <button class="icon-btn func-derive-btn" title="生成导函数曲线 f'(x)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </button>
            <button class="icon-btn func-integral-btn" title="定积分阴影与面积设置">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h10M12 3v18M7 21h10"/></svg>
            </button>
            <button class="icon-btn danger func-delete-btn" title="删除函数">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>

        ${fn.type === 'parametric' ? `
          <div class="function-input-group">
            <span class="func-prefix">x(t) =</span>
            <input type="text" class="func-input func-param-x" value="${escapeHtml(fn.exprX || '')}" placeholder="如 3*cos(t)" autocorrect="off" autocapitalize="none">
          </div>
          <div class="function-input-group" style="margin-top: 4px;">
            <span class="func-prefix">y(t) =</span>
            <input type="text" class="func-input func-param-y" value="${escapeHtml(fn.exprY || '')}" placeholder="如 3*sin(t)" autocorrect="off" autocapitalize="none">
          </div>
        ` : `
          <div class="function-input-group">
            <span class="func-prefix">${fn.type === 'polar' ? 'r(θ) =' : 'f(x) ='}</span>
            <input type="text" class="func-input func-expr-input" value="${escapeHtml(fn.expr)}" placeholder="${fn.type === 'polar' ? '如 2*cos(3*theta)' : '如 sin(x) + cos(2*x)'}" autocorrect="off" autocapitalize="none">
          </div>
        `}

        <div class="function-error ${fn.error ? 'show' : ''}">${escapeHtml(fn.error || '')}</div>

        <!-- 积分设置折叠区 -->
        <div class="integral-panel" style="display: ${fn.integral?.enabled ? 'block' : 'none'}; background: var(--bg-primary); padding: 8px; border-radius: 6px; font-size: 0.8rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span>定积分区间 [a, b]</span>
            <span class="integral-result-badge" style="font-weight: bold; color: var(--accent-color);"></span>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="number" class="slider-val-input integral-a" style="width: 50%;" value="${fn.integral?.from ?? 0}" step="0.5" placeholder="下限 a">
            <input type="number" class="slider-val-input integral-b" style="width: 50%;" value="${fn.integral?.to ?? 2}" step="0.5" placeholder="上限 b">
          </div>
        </div>

        <!-- 样式控制栏 -->
        <div class="function-options-bar">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>线宽:</span>
            <select class="func-width-select" style="background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 4px;">
              <option value="1.5" ${fn.width === 1.5 ? 'selected' : ''}>细 (1.5px)</option>
              <option value="2.5" ${fn.width === 2.5 ? 'selected' : ''}>标准 (2.5px)</option>
              <option value="4" ${fn.width === 4 ? 'selected' : ''}>粗 (4px)</option>
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>线型:</span>
            <select class="func-style-select" style="background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 4px;">
              <option value="solid" ${fn.style === 'solid' ? 'selected' : ''}>实线</option>
              <option value="dashed" ${fn.style === 'dashed' ? 'selected' : ''}>虚线</option>
              <option value="dotted" ${fn.style === 'dotted' ? 'selected' : ''}>点线</option>
            </select>
          </div>
        </div>
      `;

      // 输入公式实时更新
      const exprInput = card.querySelector('.func-expr-input');
      if (exprInput) {
        exprInput.addEventListener('input', (e) => {
          fn.expr = e.target.value;
          compileAllFunctions();
          const errDiv = card.querySelector('.function-error');
          if (fn.error) {
            errDiv.textContent = fn.error;
            errDiv.classList.add('show');
          } else {
            errDiv.classList.remove('show');
          }
          updateIntegralDisplay(card, fn);
        });
      }

      // 参数方程双输入
      const paramX = card.querySelector('.func-param-x');
      const paramY = card.querySelector('.func-param-y');
      if (paramX && paramY) {
        const handleParam = () => {
          fn.exprX = paramX.value;
          fn.exprY = paramY.value;
          compileAllFunctions();
        };
        paramX.addEventListener('input', handleParam);
        paramY.addEventListener('input', handleParam);
      }

      // 显示/隐藏切换
      const visToggle = card.querySelector('.func-visibility-toggle');
      visToggle.addEventListener('change', (e) => {
        fn.visible = e.target.checked;
        graph.render();
      });

      // 颜色选择
      const colorBadge = card.querySelector('.function-color-badge');
      colorBadge.addEventListener('click', () => {
        openColorPicker(colorBadge, (newColor) => {
          fn.color = newColor;
          colorBadge.style.backgroundColor = newColor;
          graph.render();
        });
      });

      // 删除函数
      const delBtn = card.querySelector('.func-delete-btn');
      delBtn.addEventListener('click', () => {
        state.functions = state.functions.filter(item => item.id !== fn.id);
        compileAllFunctions();
        renderFunctionList();
        showToast('已删除函数');
      });

      // 求导快捷键
      const deriveBtn = card.querySelector('.func-derive-btn');
      deriveBtn.addEventListener('click', () => {
        if (fn.type !== 'cartesian') {
          showToast('仅直角坐标函数支持快速求导', 'warning');
          return;
        }
        try {
          let derivedExpr = '';
          if (window.math && window.math.derivative) {
            derivedExpr = window.math.derivative(fn.expr, 'x').toString();
          } else {
            derivedExpr = `(${fn.expr})'`;
          }

          const newId = 'fn_' + Date.now();
          state.functions.push({
            id: newId,
            type: 'cartesian',
            expr: derivedExpr,
            color: COLOR_PALETTE[(state.functions.length + 1) % COLOR_PALETTE.length],
            width: 2,
            style: 'dashed',
            visible: true,
            compiled: null,
            error: null
          });

          compileAllFunctions();
          renderFunctionList();
          showToast(`已生成导函数 f'(x) = ${derivedExpr}`);
        } catch (e) {
          showToast('求导失败: ' + e.message, 'error');
        }
      });

      // 积分面板控制
      const integralBtn = card.querySelector('.func-integral-btn');
      const integralPanel = card.querySelector('.integral-panel');
      integralBtn.addEventListener('click', () => {
        if (!fn.integral) {
          fn.integral = { enabled: true, from: 0, to: 2, color: 'rgba(59, 130, 246, 0.25)' };
        } else {
          fn.integral.enabled = !fn.integral.enabled;
        }
        integralPanel.style.display = fn.integral.enabled ? 'block' : 'none';
        updateIntegralDisplay(card, fn);
        graph.render();
      });

      const intA = card.querySelector('.integral-a');
      const intB = card.querySelector('.integral-b');
      if (intA && intB) {
        const updateInt = () => {
          if (!fn.integral) fn.integral = { enabled: true };
          fn.integral.from = parseFloat(intA.value) || 0;
          fn.integral.to = parseFloat(intB.value) || 0;
          updateIntegralDisplay(card, fn);
          graph.render();
        };
        intA.addEventListener('input', updateInt);
        intB.addEventListener('input', updateInt);
      }

      // 线宽和线型
      const widthSelect = card.querySelector('.func-width-select');
      widthSelect.addEventListener('change', (e) => {
        fn.width = parseFloat(e.target.value);
        graph.render();
      });

      const styleSelect = card.querySelector('.func-style-select');
      styleSelect.addEventListener('change', (e) => {
        fn.style = e.target.value;
        graph.render();
      });

      updateIntegralDisplay(card, fn);
      listContainer.appendChild(card);
    });
  }

  function updateIntegralDisplay(card, fn) {
    if (!fn.integral || !fn.integral.enabled || !fn.compiled) return;
    const badge = card.querySelector('.integral-result-badge');
    if (!badge) return;
    const area = mathEngine.numericalIntegrate(fn.compiled, fn.integral.from, fn.integral.to);
    badge.textContent = `∫ = ${isNaN(area) ? 'NaN' : area.toFixed(4)}`;
  }

  // 渲染参数滑块 DOM
  function renderSliders() {
    const sliderContainer = document.getElementById('slidersList');
    sliderContainer.innerHTML = '';

    state.sliders.forEach(s => {
      const card = document.createElement('div');
      card.className = 'slider-card';
      card.dataset.name = s.name;

      card.innerHTML = `
        <div class="slider-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="icon-btn play-slider-btn" title="${s.playing ? '暂停' : '播放动画'}">
              ${s.playing ? `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ` : `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              `}
            </button>
            <span class="slider-title">${s.name}</span>
          </div>
          <input type="number" class="slider-val-input num-input" value="${s.value}" step="${s.step}">
        </div>
        <input type="range" class="range-input slider-range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
        <div class="slider-bounds">
          <span>${s.min}</span>
          <span>步长: ${s.step}</span>
          <span>${s.max}</span>
        </div>
      `;

      const rangeInput = card.querySelector('.slider-range');
      const numInput = card.querySelector('.num-input');
      const playBtn = card.querySelector('.play-slider-btn');

      const updateVal = (newVal) => {
        s.value = Number(newVal);
        rangeInput.value = s.value;
        numInput.value = s.value;
        mathEngine.setVariable(s.name, s.value);
        graph.render();
      };

      rangeInput.addEventListener('input', (e) => updateVal(e.target.value));
      numInput.addEventListener('change', (e) => updateVal(e.target.value));

      playBtn.addEventListener('click', () => {
        s.playing = !s.playing;
        renderSliders();
      });

      sliderContainer.appendChild(card);
    });
  }

  // 动画循环控制参数播放
  let animDirection = {};
  function animationLoop() {
    let hasPlaying = false;
    state.sliders.forEach(s => {
      if (s.playing) {
        hasPlaying = true;
        if (!animDirection[s.name]) animDirection[s.name] = 1;

        let nextVal = s.value + s.step * animDirection[s.name];
        if (nextVal > s.max) {
          nextVal = s.max;
          animDirection[s.name] = -1;
        } else if (nextVal < s.min) {
          nextVal = s.min;
          animDirection[s.name] = 1;
        }

        s.value = parseFloat(nextVal.toFixed(3));
        mathEngine.setVariable(s.name, s.value);

        const card = document.querySelector(`.slider-card[data-name="${s.name}"]`);
        if (card) {
          const range = card.querySelector('.slider-range');
          const num = card.querySelector('.num-input');
          if (range) range.value = s.value;
          if (num) num.value = s.value;
        }
      }
    });

    if (hasPlaying) {
      graph.render();
    }
    requestAnimationFrame(animationLoop);
  }
  requestAnimationFrame(animationLoop);

  // 调色盘弹窗
  function openColorPicker(anchorElem, onSelect) {
    const existing = document.getElementById('popoverColorPicker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'popoverColorPicker';
    picker.style.cssText = `
      position: fixed;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 28px rgba(0,0,0,0.4);
      padding: 12px;
      border-radius: 10px;
      z-index: 120;
      display: grid;
      grid-template-columns: repeat(4, 32px);
      gap: 10px;
    `;

    const rect = anchorElem.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      picker.style.left = '50%';
      picker.style.top = '40%';
      picker.style.transform = 'translate(-50%, -50%)';
    } else {
      picker.style.left = `${Math.min(window.innerWidth - 180, rect.left)}px`;
      picker.style.top = `${rect.bottom + 6}px`;
    }

    COLOR_PALETTE.forEach(c => {
      const opt = document.createElement('div');
      opt.className = 'color-option';
      opt.style.backgroundColor = c;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(c);
        picker.remove();
      });
      picker.appendChild(opt);
    });

    document.body.appendChild(picker);

    const closeHandler = (e) => {
      if (!picker.contains(e.target) && e.target !== anchorElem) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
        document.removeEventListener('touchstart', closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeHandler);
      document.addEventListener('touchstart', closeHandler);
    }, 10);
  }

  // 底部信息条更新
  function updateViewDisplay(bounds) {
    const viewSpan = document.getElementById('viewBoundsDisplay');
    if (viewSpan) {
      viewSpan.textContent = `X:[${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}]`;
    }
  }

  function updateCursorDisplay(cursor) {
    const cursorSpan = document.getElementById('cursorPosDisplay');
    if (cursorSpan && cursor) {
      cursorSpan.textContent = `(${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)})`;
    }
  }

  // 加载预设
  function loadPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;

    state.functions = preset.functions.map((fn, idx) => ({
      id: 'fn_' + (idx + 1),
      ...fn,
      compiled: null,
      error: null
    }));

    if (preset.vars) {
      Object.entries(preset.vars).forEach(([k, v]) => {
        mathEngine.setVariable(k, v);
        const sl = state.sliders.find(s => s.name === k);
        if (sl) sl.value = v;
      });
      renderSliders();
    }

    if (preset.center) {
      graph.centerX = preset.center.x;
      graph.centerY = preset.center.y;
    }
    if (preset.scale) {
      graph.scale = preset.scale;
      graph.scaleY = preset.scale;
    }
    if (preset.gridMode) {
      graph.gridMode = preset.gridMode;
      const select = document.getElementById('gridModeSelect');
      if (select) select.value = preset.gridMode;
      updateMobileGridLabel();
    }

    compileAllFunctions();
    renderFunctionList();
    graph.render();
    showToast(`已加载预设: ${preset.name}`);
  }

  function updateMobileGridLabel() {
    const gridLabel = document.getElementById('mobileGridLabel');
    if (gridLabel) {
      const modeName = graph.gridMode === 'cartesian' ? '直角网格' : (graph.gridMode === 'polar' ? '极坐标网格' : '无网格');
      gridLabel.textContent = `切换网格: ${modeName}`;
    }
  }

  // Toast 弹窗通知
  function showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  // HTML 转义
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 绑定全局与顶部事件
  function bindUIEvents() {
    const sidebar = document.getElementById('sidebar');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const mobileOpenPanelFab = document.getElementById('mobileOpenPanelFab');

    // 桌面端侧边栏折叠
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        setTimeout(() => graph.resize(), 300);
      });
    }

    // 移动端侧边栏打开与关闭
    const openMobileSidebar = () => {
      sidebar.classList.add('open');
      sidebarBackdrop.classList.add('active');
    };

    const closeMobileSidebar = () => {
      sidebar.classList.remove('open');
      sidebarBackdrop.classList.remove('active');
    };

    if (mobileOpenPanelFab) {
      mobileOpenPanelFab.addEventListener('click', openMobileSidebar);
    }
    if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', closeMobileSidebar);
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }

    // 移动端更多操作弹窗
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenuModal = document.getElementById('mobileMenuModal');
    const closeMobileMenuBtn = document.getElementById('closeMobileMenuBtn');

    // 屏幕宽度检测决定移动端菜单按钮显示
    const checkResponsive = () => {
      if (window.innerWidth <= 768) {
        if (mobileMenuBtn) mobileMenuBtn.style.display = 'inline-flex';
      } else {
        if (mobileMenuBtn) mobileMenuBtn.style.display = 'none';
        if (mobileMenuModal) mobileMenuModal.classList.remove('active');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
        sidebar.classList.remove('open');
      }
    };
    checkResponsive();
    window.addEventListener('resize', checkResponsive);

    if (mobileMenuBtn && mobileMenuModal) {
      mobileMenuBtn.addEventListener('click', () => {
        updateMobileGridLabel();
        mobileMenuModal.classList.add('active');
      });

      closeMobileMenuBtn.addEventListener('click', () => {
        mobileMenuModal.classList.remove('active');
      });

      mobileMenuModal.addEventListener('click', (e) => {
        if (e.target === mobileMenuModal) {
          mobileMenuModal.classList.remove('active');
        }
      });
    }

    // 移动端菜单功能绑定
    const mobileActionExport = document.getElementById('mobileActionExport');
    if (mobileActionExport) {
      mobileActionExport.addEventListener('click', () => {
        mobileMenuModal.classList.remove('active');
        document.getElementById('exportPngBtn').click();
      });
    }

    const mobileActionCopy = document.getElementById('mobileActionCopy');
    if (mobileActionCopy) {
      mobileActionCopy.addEventListener('click', () => {
        mobileMenuModal.classList.remove('active');
        document.getElementById('copyImageBtn').click();
      });
    }

    const mobileActionGrid = document.getElementById('mobileActionGrid');
    if (mobileActionGrid) {
      mobileActionGrid.addEventListener('click', () => {
        const modes = ['cartesian', 'polar', 'none'];
        const nextIdx = (modes.indexOf(graph.gridMode) + 1) % modes.length;
        graph.gridMode = modes[nextIdx];
        const select = document.getElementById('gridModeSelect');
        if (select) select.value = graph.gridMode;
        graph.render();
        updateMobileGridLabel();
        showToast(`已切换为: ${graph.gridMode === 'cartesian' ? '直角坐标网格' : (graph.gridMode === 'polar' ? '极坐标网格' : '无网格')}`);
      });
    }

    const mobileActionReset = document.getElementById('mobileActionReset');
    if (mobileActionReset) {
      mobileActionReset.addEventListener('click', () => {
        mobileMenuModal.classList.remove('active');
        graph.resetView();
        showToast('视口已复位到原点');
      });
    }

    // 选项卡切换
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(btn.dataset.tab);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // 添加函数按钮
    const addCartesianBtn = document.getElementById('addCartesianBtn');
    addCartesianBtn.addEventListener('click', () => {
      const nextColor = COLOR_PALETTE[state.functions.length % COLOR_PALETTE.length];
      state.functions.push({
        id: 'fn_' + Date.now(),
        type: 'cartesian',
        expr: 'cos(x)',
        color: nextColor,
        width: 2.5,
        style: 'solid',
        visible: true,
        compiled: null,
        error: null
      });
      compileAllFunctions();
      renderFunctionList();
      showToast('已添加直角坐标函数');
    });

    const addPolarBtn = document.getElementById('addPolarBtn');
    addPolarBtn.addEventListener('click', () => {
      const nextColor = COLOR_PALETTE[state.functions.length % COLOR_PALETTE.length];
      state.functions.push({
        id: 'fn_' + Date.now(),
        type: 'polar',
        expr: '2 * sin(4 * theta)',
        color: nextColor,
        width: 2.5,
        style: 'solid',
        visible: true,
        domain: { min: 0, max: 6.283 },
        compiled: null,
        error: null
      });
      compileAllFunctions();
      renderFunctionList();
      showToast('已添加极坐标函数');
    });

    const addParamBtn = document.getElementById('addParamBtn');
    addParamBtn.addEventListener('click', () => {
      const nextColor = COLOR_PALETTE[state.functions.length % COLOR_PALETTE.length];
      state.functions.push({
        id: 'fn_' + Date.now(),
        type: 'parametric',
        exprX: '3 * cos(t)',
        exprY: '2 * sin(2 * t)',
        color: nextColor,
        width: 2.5,
        style: 'solid',
        visible: true,
        domain: { min: -6.28, max: 6.28 },
        compiled: null,
        error: null
      });
      compileAllFunctions();
      renderFunctionList();
      showToast('已添加参数方程');
    });

    // 添加自定义滑块
    const addSliderBtn = document.getElementById('addSliderBtn');
    addSliderBtn.addEventListener('click', () => {
      const name = prompt('请输入新变量名 (如 c, m, omega 等):', 'c');
      if (!name) return;
      const cleanName = name.trim();
      if (!/^[a-zA-Z_]\w*$/.test(cleanName)) {
        showToast('变量名不合法，必须以字母或下划线开头', 'error');
        return;
      }
      if (state.sliders.some(s => s.name === cleanName)) {
        showToast('该变量已存在', 'error');
        return;
      }
      state.sliders.push({
        name: cleanName,
        min: -5,
        max: 5,
        step: 0.1,
        value: 1.0,
        playing: false
      });
      mathEngine.setVariable(cleanName, 1.0);
      renderSliders();
      showToast(`已添加参数滑块 ${cleanName}`);
    });

    // 预设选择器
    const presetSelect = document.getElementById('presetSelect');
    presetSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadPreset(e.target.value);
        e.target.value = '';
      }
    });

    // 网格模式切换
    const gridModeSelect = document.getElementById('gridModeSelect');
    gridModeSelect.addEventListener('change', (e) => {
      graph.gridMode = e.target.value;
      graph.render();
      updateMobileGridLabel();
    });

    // 主题切换
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    themeToggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      graph.setTheme(state.theme);
      themeToggleBtn.innerHTML = state.theme === 'dark' ? `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      ` : `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      `;
    });

    // 画布快捷浮动按钮
    document.getElementById('zoomInBtn').addEventListener('click', () => graph.zoomIn());
    document.getElementById('zoomOutBtn').addEventListener('click', () => graph.zoomOut());
    document.getElementById('resetViewBtn').addEventListener('click', () => {
      graph.resetView();
      showToast('视口已复位到原点');
    });

    // 高级分析开关
    const toggleTangent = document.getElementById('toggleTangentCheck');
    if (toggleTangent) {
      toggleTangent.addEventListener('change', (e) => {
        graph.showTangent = e.target.checked;
        graph.render();
      });
    }

    const toggleRoots = document.getElementById('toggleRootsCheck');
    if (toggleRoots) {
      toggleRoots.addEventListener('change', (e) => {
        graph.showRoots = e.target.checked;
        graph.render();
      });
    }

    // 导出图片
    const exportPngBtn = document.getElementById('exportPngBtn');
    exportPngBtn.addEventListener('click', () => {
      const dataUrl = graph.exportImage({ scale: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `function-graph-${Date.now()}.png`;
      a.click();
      showToast('已导出高清 PNG 图像');
    });

    const copyImageBtn = document.getElementById('copyImageBtn');
    copyImageBtn.addEventListener('click', async () => {
      try {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = graph.width;
        offCanvas.height = graph.height;
        const ctx = offCanvas.getContext('2d');
        ctx.drawImage(graph.canvas, 0, 0, graph.width, graph.height);

        offCanvas.toBlob(async (blob) => {
          if (!blob) return;
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          showToast('图像已复制到剪贴板！');
        });
      } catch (err) {
        showToast('复制失败，请直接使用导出下载', 'error');
      }
    });

    // 快捷键支持
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '=' || e.key === '+') {
        graph.zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        graph.zoomOut();
      } else if (e.key === '0' || e.code === 'Space') {
        graph.resetView();
      }
    });
  }

  // 启动并渲染
  compileAllFunctions();
  renderFunctionList();
  renderSliders();
  bindUIEvents();
  updateViewDisplay(graph.getBounds());
});
