/**
 * Canvas 绘图引擎
 * 负责网格渲染、坐标映射、曲线自适应采样、奇点处理、触控手势与切线交互
 */

class GraphCanvas {
  constructor(canvasElement, mathEngine, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.math = mathEngine;

    // 视口状态
    this.centerX = 0; // 视口中心对应的数学坐标 X
    this.centerY = 0; // 视口中心对应的数学坐标 Y
    this.scale = 40;  // 1 个数学单位对应的屏幕像素数
    this.scaleY = 40; // 独立 Y 轴缩放
    this.aspectRatioLocked = true;

    // 交互状态
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastMousePos = null; // 当前指针数学坐标 {x, y, screenX, screenY}
    this.closestPoint = null; // 吸附到的曲线上点

    // 渲染选项
    this.theme = 'dark'; // 'dark' | 'light'
    this.gridMode = 'cartesian'; // 'cartesian' | 'polar' | 'none'
    this.showCoordinates = true;
    this.showTangent = false;
    this.showRoots = false;
    this.activeTangentFuncId = null;

    // 函数列表
    this.functions = [];

    // 回调通知
    this.onViewChange = options.onViewChange || null;
    this.onCursorMove = options.onCursorMove || null;

    this.initEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;

    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);

    this.render();
  }

  // 坐标转换：数学坐标 -> 屏幕像素
  toScreenX(x) {
    return (x - this.centerX) * this.scale + this.width / 2;
  }

  toScreenY(y) {
    return this.height / 2 - (y - this.centerY) * this.scaleY;
  }

  // 坐标转换：屏幕像素 -> 数学坐标
  toMathX(screenX) {
    return (screenX - this.width / 2) / this.scale + this.centerX;
  }

  toMathY(screenY) {
    return (this.height / 2 - screenY) / this.scaleY + this.centerY;
  }

  // 获取当前视口的数学坐标边界 [minX, maxX, minY, maxY]
  getBounds() {
    return {
      minX: this.toMathX(0),
      maxX: this.toMathX(this.width),
      minY: this.toMathY(this.height),
      maxY: this.toMathY(0)
    };
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.resize(), 150);
    });

    // ---------------- 鼠标桌面交互 ----------------
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      if (screenX >= 0 && screenX <= this.width && screenY >= 0 && screenY <= this.height) {
        this.lastMousePos = {
          screenX,
          screenY,
          x: this.toMathX(screenX),
          y: this.toMathY(screenY)
        };
        this.updateHoverTracking();
        if (this.onCursorMove) {
          this.onCursorMove(this.lastMousePos, this.closestPoint);
        }
      } else {
        if (!this.isDragging) {
          this.lastMousePos = null;
          this.closestPoint = null;
        }
      }

      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        this.centerX -= dx / this.scale;
        this.centerY += dy / this.scaleY;

        if (this.onViewChange) this.onViewChange(this.getBounds());
        this.render();
      } else if (this.lastMousePos) {
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'crosshair';
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (!this.isDragging) {
        this.lastMousePos = null;
        this.closestPoint = null;
        this.render();
      }
    });

    // 滚轮缩放 (以光标所在数学点为中心)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseScreenX = e.clientX - rect.left;
      const mouseScreenY = e.clientY - rect.top;

      const mouseMathX = this.toMathX(mouseScreenX);
      const mouseMathY = this.toMathY(mouseScreenY);

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.1, Math.min(200000, this.scale * zoomFactor));
      const newScaleY = this.aspectRatioLocked ? newScale : Math.max(0.1, Math.min(200000, this.scaleY * zoomFactor));

      this.scale = newScale;
      this.scaleY = newScaleY;

      this.centerX = mouseMathX - (mouseScreenX - this.width / 2) / this.scale;
      this.centerY = mouseMathY - (this.height / 2 - mouseScreenY) / this.scaleY;

      if (this.onViewChange) this.onViewChange(this.getBounds());
      this.render();
    }, { passive: false });

    // ---------------- 移动端触屏手势 ----------------
    let touchState = {
      mode: 'none', // 'drag' | 'pinch'
      lastX: 0,
      lastY: 0,
      initialDist: 0,
      initialScale: 40,
      initialMidMathX: 0,
      initialMidMathY: 0,
      lastTapTime: 0,
      lastTapX: 0,
      lastTapY: 0
    };

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();

      if (e.touches.length === 1) {
        touchState.mode = 'drag';
        touchState.lastX = e.touches[0].clientX;
        touchState.lastY = e.touches[0].clientY;

        const screenX = e.touches[0].clientX - rect.left;
        const screenY = e.touches[0].clientY - rect.top;
        this.lastMousePos = {
          screenX,
          screenY,
          x: this.toMathX(screenX),
          y: this.toMathY(screenY)
        };
        this.updateHoverTracking();
        if (this.onCursorMove) {
          this.onCursorMove(this.lastMousePos, this.closestPoint);
        }

        // 双击检测 (Double tap to reset view)
        const now = Date.now();
        const distFromLastTap = Math.hypot(touchState.lastX - touchState.lastTapX, touchState.lastY - touchState.lastTapY);
        if (now - touchState.lastTapTime < 320 && distFromLastTap < 30) {
          this.resetView();
          touchState.lastTapTime = 0;
        } else {
          touchState.lastTapTime = now;
          touchState.lastTapX = touchState.lastX;
          touchState.lastTapY = touchState.lastY;
        }

        this.render();
      } else if (e.touches.length >= 2) {
        touchState.mode = 'pinch';
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        touchState.initialDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        touchState.initialScale = this.scale;

        const midScreenX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midScreenY = (t1.clientY + t2.clientY) / 2 - rect.top;
        touchState.initialMidMathX = this.toMathX(midScreenX);
        touchState.initialMidMathY = this.toMathY(midScreenY);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();

      if (e.touches.length === 1 && touchState.mode === 'drag') {
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        const dx = curX - touchState.lastX;
        const dy = curY - touchState.lastY;
        touchState.lastX = curX;
        touchState.lastY = curY;

        this.centerX -= dx / this.scale;
        this.centerY -= dy / this.scaleY;

        const screenX = curX - rect.left;
        const screenY = curY - rect.top;
        this.lastMousePos = {
          screenX,
          screenY,
          x: this.toMathX(screenX),
          y: this.toMathY(screenY)
        };
        this.updateHoverTracking();
        if (this.onCursorMove) {
          this.onCursorMove(this.lastMousePos, this.closestPoint);
        }
        if (this.onViewChange) this.onViewChange(this.getBounds());
        this.render();
      } else if (e.touches.length >= 2 && touchState.mode === 'pinch') {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

        if (touchState.initialDist > 0) {
          const factor = currentDist / touchState.initialDist;
          const newScale = Math.max(0.1, Math.min(200000, touchState.initialScale * factor));
          this.scale = newScale;
          if (this.aspectRatioLocked) this.scaleY = newScale;

          const midScreenX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const midScreenY = (t1.clientY + t2.clientY) / 2 - rect.top;

          // 保持双指中心处的数学点不动
          this.centerX = touchState.initialMidMathX - (midScreenX - this.width / 2) / this.scale;
          this.centerY = touchState.initialMidMathY - (this.height / 2 - midScreenY) / this.scaleY;

          if (this.onViewChange) this.onViewChange(this.getBounds());
          this.render();
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        touchState.mode = 'none';
        setTimeout(() => {
          if (touchState.mode === 'none') {
            this.lastMousePos = null;
            this.closestPoint = null;
            this.render();
          }
        }, 2000);
      } else if (e.touches.length === 1) {
        touchState.mode = 'drag';
        touchState.lastX = e.touches[0].clientX;
        touchState.lastY = e.touches[0].clientY;
      }
    });

    this.canvas.addEventListener('touchcancel', () => {
      touchState.mode = 'none';
    });

    // 双击重置原点居中 (桌面鼠标)
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = this.toMathX(e.clientX - rect.left);
      const y = this.toMathY(e.clientY - rect.top);
      this.centerAt(x, y);
    });
  }

  centerAt(x, y) {
    this.centerX = x;
    this.centerY = y;
    if (this.onViewChange) this.onViewChange(this.getBounds());
    this.render();
  }

  resetView() {
    this.centerX = 0;
    this.centerY = 0;
    this.scale = 40;
    this.scaleY = 40;
    if (this.onViewChange) this.onViewChange(this.getBounds());
    this.render();
  }

  zoomIn() {
    this.scale *= 1.3;
    if (this.aspectRatioLocked) this.scaleY = this.scale;
    if (this.onViewChange) this.onViewChange(this.getBounds());
    this.render();
  }

  zoomOut() {
    this.scale /= 1.3;
    if (this.aspectRatioLocked) this.scaleY = this.scale;
    if (this.onViewChange) this.onViewChange(this.getBounds());
    this.render();
  }

  setTheme(theme) {
    this.theme = theme;
    this.render();
  }

  setFunctions(funcList) {
    this.functions = funcList;
    this.render();
  }

  // 悬停/触摸吸附最近曲线计算
  updateHoverTracking() {
    if (!this.lastMousePos) {
      this.closestPoint = null;
      return;
    }

    const { x: mouseX, y: mouseY, screenX, screenY } = this.lastMousePos;
    let closest = null;
    let minDistance = 30; // 触控友好阈值

    for (const fn of this.functions) {
      if (!fn.visible || !fn.compiled) continue;

      if (fn.type === 'cartesian') {
        const yVal = fn.compiled.evaluate(mouseX);
        if (!isNaN(yVal)) {
          const sy = this.toScreenY(yVal);
          const dist = Math.abs(sy - screenY);
          if (dist < minDistance) {
            minDistance = dist;
            const deriv = this.math.numericalDerivative(fn.compiled, mouseX);
            closest = {
              func: fn,
              x: mouseX,
              y: yVal,
              derivative: deriv,
              screenX: this.toScreenX(mouseX),
              screenY: sy
            };
          }
        }
      }
    }

    this.closestPoint = closest;
  }

  // 自适应网格步长
  calculateNiceStep(targetPixelStep = 75, scaleVal = this.scale) {
    const rawStep = targetPixelStep / scaleVal;
    const exponent = Math.floor(Math.log10(rawStep));
    const fraction = rawStep / Math.pow(10, exponent);

    let niceFraction;
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3.5) niceFraction = 2;
    else if (fraction < 7.5) niceFraction = 5;
    else niceFraction = 10;

    return niceFraction * Math.pow(10, exponent);
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const w = this.width;
    const h = this.height;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const isDark = this.theme === 'dark';
    const bgColor = isDark ? '#0f172a' : '#ffffff';
    const axisColor = isDark ? '#94a3b8' : '#334155';
    const majorGridColor = isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(203, 213, 225, 0.7)';
    const minorGridColor = isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(241, 245, 249, 0.9)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (this.gridMode === 'cartesian') {
      this.drawCartesianGrid(ctx, w, h, majorGridColor, minorGridColor, axisColor, textColor);
    } else if (this.gridMode === 'polar') {
      this.drawPolarGrid(ctx, w, h, majorGridColor, axisColor, textColor);
    }

    this.drawIntegrals(ctx);
    this.drawFunctions(ctx);

    if (this.showRoots) {
      this.drawRoots(ctx);
    }

    if (this.showTangent && this.closestPoint && this.closestPoint.func) {
      this.drawTangentLine(ctx, this.closestPoint);
    }

    this.drawCursorOverlay(ctx, textColor, isDark);
  }

  drawCartesianGrid(ctx, w, h, majorGrid, minorGrid, axisColor, textColor) {
    const stepX = this.calculateNiceStep(80, this.scale);
    const stepY = this.calculateNiceStep(80, this.scaleY);

    const bounds = this.getBounds();
    const startX = Math.floor(bounds.minX / stepX) * stepX;
    const endX = Math.ceil(bounds.maxX / stepX) * stepX;
    const startY = Math.floor(bounds.minY / stepY) * stepY;
    const endY = Math.ceil(bounds.maxY / stepY) * stepY;

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = minorGrid;
    const subStepX = stepX / 5;
    const subStepY = stepY / 5;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += subStepX) {
      const sx = Math.round(this.toScreenX(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = startY; y <= endY; y += subStepY) {
      const sy = Math.round(this.toScreenY(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = majorGrid;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += stepX) {
      const sx = Math.round(this.toScreenX(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = startY; y <= endY; y += stepY) {
      const sy = Math.round(this.toScreenY(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    const originSx = this.toScreenX(0);
    const originSy = this.toScreenY(0);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = axisColor;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(originSy) + 0.5);
    ctx.lineTo(w, Math.round(originSy) + 0.5);
    ctx.moveTo(Math.round(originSx) + 0.5, 0);
    ctx.lineTo(Math.round(originSx) + 0.5, h);
    ctx.stroke();

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelY = Math.max(15, Math.min(h - 20, originSy + 6));
    const labelX = Math.max(25, Math.min(w - 20, originSx - 6));

    for (let x = startX; x <= endX; x += stepX) {
      if (Math.abs(x) < stepX * 0.1) continue;
      const sx = this.toScreenX(x);
      const text = this.formatNumber(x);
      ctx.fillText(text, sx, labelY);

      ctx.beginPath();
      ctx.moveTo(sx, originSy - 3);
      ctx.lineTo(sx, originSy + 3);
      ctx.stroke();
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = startY; y <= endY; y += stepY) {
      if (Math.abs(y) < stepY * 0.1) continue;
      const sy = this.toScreenY(y);
      const text = this.formatNumber(y);
      ctx.fillText(text, labelX, sy);

      ctx.beginPath();
      ctx.moveTo(originSx - 3, sy);
      ctx.lineTo(originSx + 3, sy);
      ctx.stroke();
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0', originSx - 4, originSy + 4);
  }

  drawPolarGrid(ctx, w, h, gridColor, axisColor, textColor) {
    const originSx = this.toScreenX(0);
    const originSy = this.toScreenY(0);
    const maxRadius = Math.hypot(w, h);
    const stepR = this.calculateNiceStep(70, this.scale);

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    for (let r = stepR; r * this.scale < maxRadius; r += stepR) {
      const radiusPx = r * this.scale;
      ctx.beginPath();
      ctx.arc(originSx, originSy, radiusPx, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = '10px sans-serif';
      ctx.fillStyle = textColor;
      ctx.fillText(this.formatNumber(r), originSx + radiusPx + 2, originSy - 4);
    }

    const angles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(originSx, originSy);
      ctx.lineTo(originSx + Math.cos(rad) * maxRadius, originSy - Math.sin(rad) * maxRadius);
      ctx.stroke();
    }

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, originSy);
    ctx.lineTo(w, originSy);
    ctx.moveTo(originSx, 0);
    ctx.lineTo(originSx, h);
    ctx.stroke();
  }

  formatNumber(val) {
    if (Math.abs(val) < 1e-9) return '0';
    if (Math.abs(val) >= 10000 || Math.abs(val) <= 0.001) {
      return val.toExponential(1).replace('+', '');
    }
    return Number(val.toFixed(4)).toString();
  }

  drawIntegrals(ctx) {
    for (const fn of this.functions) {
      if (!fn.visible || !fn.integral || !fn.integral.enabled || !fn.compiled) continue;
      const { from = 0, to = 2, color = 'rgba(59, 130, 246, 0.25)' } = fn.integral;
      if (from >= to) continue;

      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();

      const startSx = this.toScreenX(from);
      const endSx = this.toScreenX(to);
      const originSy = this.toScreenY(0);

      ctx.moveTo(startSx, originSy);

      const steps = Math.min(1000, Math.max(100, Math.abs(endSx - startSx)));
      const dx = (to - from) / steps;

      for (let i = 0; i <= steps; i++) {
        const x = from + i * dx;
        const y = fn.compiled.evaluate(x);
        if (!isNaN(y)) {
          ctx.lineTo(this.toScreenX(x), this.toScreenY(y));
        }
      }

      ctx.lineTo(endSx, originSy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawFunctions(ctx) {
    const bounds = this.getBounds();

    for (const fn of this.functions) {
      if (!fn.visible || !fn.compiled) continue;

      ctx.save();
      ctx.strokeStyle = fn.color || '#3b82f6';
      ctx.lineWidth = fn.width || 2.5;

      if (fn.style === 'dashed') {
        ctx.setLineDash([8, 6]);
      } else if (fn.style === 'dotted') {
        ctx.setLineDash([2, 4]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();

      if (fn.type === 'cartesian') {
        this.renderCartesianFunction(ctx, fn, bounds);
      } else if (fn.type === 'polar') {
        this.renderPolarFunction(ctx, fn);
      } else if (fn.type === 'parametric') {
        this.renderParametricFunction(ctx, fn);
      }

      ctx.stroke();
      ctx.restore();
    }
  }

  renderCartesianFunction(ctx, fn, bounds) {
    const minX = fn.domain?.min !== undefined ? Math.max(bounds.minX, fn.domain.min) : bounds.minX;
    const maxX = fn.domain?.max !== undefined ? Math.min(bounds.maxX, fn.domain.max) : bounds.maxX;

    if (minX >= maxX) return;

    const totalPixels = (maxX - minX) * this.scale;
    const numPoints = Math.min(3000, Math.max(300, Math.floor(totalPixels * 1.5)));
    const dx = (maxX - minX) / numPoints;

    let isDrawing = false;
    let prevY = null;
    let prevScreenY = null;

    for (let i = 0; i <= numPoints; i++) {
      const x = minX + i * dx;
      const y = fn.compiled.evaluate(x);

      if (isNaN(y) || !isFinite(y)) {
        isDrawing = false;
        prevY = null;
        prevScreenY = null;
        continue;
      }

      const sx = this.toScreenX(x);
      const sy = this.toScreenY(y);

      if (prevY !== null) {
        const deltaScreenY = Math.abs(sy - prevScreenY);
        if (deltaScreenY > this.height * 0.7 && Math.sign(y) !== Math.sign(prevY)) {
          isDrawing = false;
        }
      }

      if (!isDrawing) {
        ctx.moveTo(sx, sy);
        isDrawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }

      prevY = y;
      prevScreenY = sy;
    }
  }

  renderPolarFunction(ctx, fn) {
    const minTheta = fn.domain?.min ?? 0;
    const maxTheta = fn.domain?.max ?? (Math.PI * 4);
    const steps = 1500;
    const dTheta = (maxTheta - minTheta) / steps;

    let isDrawing = false;
    for (let i = 0; i <= steps; i++) {
      const theta = minTheta + i * dTheta;
      const r = fn.compiled.evaluate(theta, { theta, θ: theta });

      if (isNaN(r) || !isFinite(r)) {
        isDrawing = false;
        continue;
      }

      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const sx = this.toScreenX(x);
      const sy = this.toScreenY(y);

      if (!isDrawing) {
        ctx.moveTo(sx, sy);
        isDrawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
  }

  renderParametricFunction(ctx, fn) {
    if (!fn.compiledX || !fn.compiledY) return;
    const minT = fn.domain?.min ?? -10;
    const maxT = fn.domain?.max ?? 10;
    const steps = 1500;
    const dt = (maxT - minT) / steps;

    let isDrawing = false;
    for (let i = 0; i <= steps; i++) {
      const t = minT + i * dt;
      const x = fn.compiledX.evaluate(t, { t });
      const y = fn.compiledY.evaluate(t, { t });

      if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
        isDrawing = false;
        continue;
      }

      const sx = this.toScreenX(x);
      const sy = this.toScreenY(y);

      if (!isDrawing) {
        ctx.moveTo(sx, sy);
        isDrawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
  }

  drawRoots(ctx) {
    const bounds = this.getBounds();
    ctx.save();
    ctx.font = '10px sans-serif';

    for (const fn of this.functions) {
      if (!fn.visible || fn.type !== 'cartesian' || !fn.compiled) continue;
      const roots = this.math.findRoots(fn.compiled, bounds.minX, bounds.maxX);

      for (const rx of roots) {
        const sx = this.toScreenX(rx);
        const sy = this.toScreenY(0);

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.theme === 'dark' ? '#fca5a5' : '#991b1b';
        ctx.fillText(`(${rx.toFixed(2)}, 0)`, sx + 6, sy - 6);
      }
    }
    ctx.restore();
  }

  drawTangentLine(ctx, point) {
    const { x, y, derivative } = point;
    if (isNaN(derivative) || !isFinite(derivative)) return;

    const bounds = this.getBounds();
    const length = (bounds.maxX - bounds.minX) * 0.3;
    const x1 = x - length;
    const y1 = y - derivative * length;
    const x2 = x + length;
    const y2 = y + derivative * length;

    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(this.toScreenX(x1), this.toScreenY(y1));
    ctx.lineTo(this.toScreenX(x2), this.toScreenY(y2));
    ctx.stroke();

    const text = `切线斜率 k = ${derivative.toFixed(3)}`;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(text, point.screenX + 12, point.screenY - 12);
    ctx.restore();
  }

  drawCursorOverlay(ctx, textColor, isDark) {
    if (!this.lastMousePos) return;
    const { screenX, screenY } = this.lastMousePos;

    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, this.height);
    ctx.moveTo(0, screenY);
    ctx.lineTo(this.width, screenY);
    ctx.stroke();
    ctx.restore();

    if (this.closestPoint) {
      const p = this.closestPoint;
      ctx.save();

      ctx.fillStyle = p.func.color || '#3b82f6';
      ctx.beginPath();
      ctx.arc(p.screenX, p.screenY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      const coordText = `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const textWidth = ctx.measureText(coordText).width;

      const padX = 8, padY = 5;
      const boxW = textWidth + padX * 2;
      const boxH = 24;
      let boxX = p.screenX + 10;
      let boxY = p.screenY - 32;

      if (boxX + boxW > this.width - 10) boxX = p.screenX - boxW - 10;
      if (boxY < 10) boxY = p.screenY + 14;

      ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 8;
      ctx.roundRect ? ctx.roundRect(boxX, boxY, boxW, boxH, 6) : ctx.rect(boxX, boxY, boxW, boxH);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(coordText, boxX + padX, boxY + boxH / 2);

      ctx.restore();
    }
  }

  exportImage(options = { scale: 2 }) {
    const exportScale = options.scale || 2;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = this.width * exportScale;
    offCanvas.height = this.height * exportScale;
    const offCtx = offCanvas.getContext('2d');

    offCtx.scale(exportScale, exportScale);

    const originalCtx = this.ctx;
    const originalDpr = this.dpr;

    this.ctx = offCtx;
    this.dpr = 1;
    this.render();

    const dataUrl = offCanvas.toDataURL('image/png');

    this.ctx = originalCtx;
    this.dpr = originalDpr;
    this.render();

    return dataUrl;
  }
}

window.GraphCanvas = GraphCanvas;
