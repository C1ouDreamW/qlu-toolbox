(() => {
  if (location.origin !== 'https://jw.qlu.edu.cn' || !location.pathname.endsWith('/jxzxjhck_cxJxzxjhckIndex.html')) return;
  if (window.__LUMATILE_PLAN_LIST__) return;
  const state = window.__LUMATILE_PLAN_LIST__ = { items: null };
  // 学校脚本把 trim 改写成移除全部空白，这里手工只去 BOM 与首尾空白。
  const edgeTrim = value => {
    const text = String(value);
    const length = text.length;
    let start = length && text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    let end = length;
    while (start < end && text.charCodeAt(start) < 33) start++;
    while (end > start && text.charCodeAt(end - 1) < 33) end--;
    return start === 0 && end === length ? text : text.slice(start, end);
  };
  const isPlanQuery = value => {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname === location.pathname && url.searchParams.get('doType') === 'query';
    } catch { return false; }
  };
  const capture = text => {
    try {
      if (text.length > 8 * 1024 * 1024) return;
      const data = JSON.parse(edgeTrim(text));
      if (!state.items && Array.isArray(data?.items) && data.items.length) state.items = data.items;
    } catch { /* 与桌面端一致，忽略无法解析的列表响应并等待下一次。 */ }
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (isPlanQuery(url)) this.addEventListener('load', () => {
      try { capture(this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText); } catch {}
    }, { once: true });
    return originalOpen.apply(this, arguments);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const take = isPlanQuery(typeof input === 'string' || input instanceof URL ? input : input.url);
    return originalFetch(input, init).then(response => {
      if (take) response.clone().text().then(capture).catch(() => {});
      return response;
    });
  };
})()
