(() => {
  if (window.__LUMATILE_SCHEDULE_IMPORT__?.installed) return true;
  const state = window.__LUMATILE_SCHEDULE_IMPORT__ = { installed: true, started: false, result: null, base64: null, message: '正在读取培养方案…' };
  const root = '/jwglxt/';
  const warnings = [];
  // 学校脚本把 trim 改写成移除全部空白（与 filter/some 同一批覆盖），会毁掉要求页解析，这里手工只去 BOM 与首尾空白。
  const edgeTrim = value => {
    const text = String(value);
    const length = text.length;
    let start = length && text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    let end = length;
    while (start < end && text.charCodeAt(start) < 33) start++;
    while (end > start && text.charCodeAt(end - 1) < 33) end--;
    return start === 0 && end === length ? text : text.slice(start, end);
  };
  async function request(path, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(root + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}) }, body });
      if (!response.ok) throw Error('教务接口返回 HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw Error('教务响应超过安全限制');
      return edgeTrim(text);
    } finally { clearTimeout(timer); }
  }
  async function query(path, body) {
    const items = [];
    for (let page = 1; page <= 20; page++) {
      const data = JSON.parse(await request(path, body + '&queryModel.showCount=1000&queryModel.currentPage=' + page));
      // 只兼容分页信息明确为空的首个结果，不能把异常响应或缺失的后续页当作空成绩。
      if (page === 1 && data?.items == null && [0, '0'].includes(data?.totalResult) && [0, '0'].includes(data?.totalPage)) return items;
      if (!data || !Array.isArray(data.items)) {
        const shape = data == null ? 'null' : Array.isArray(data) ? '数组' : typeof data;
        const listShape = data?.items === undefined ? '缺失' : data.items === null ? 'null' : typeof data.items;
        throw Error('教务响应格式异常（响应类型：' + shape + '，items：' + listShape + '），请重试；若仍失败，请反馈此提示');
      }
      // 学校覆盖了 Array.filter/some（回调先传下标），页面内必须用原生循环筛选。
      for (const item of data.items) {
        if (item && typeof item === 'object' && !Array.isArray(item)) items.push(item);
      }
      if (data.items.length < 1000 && !(Number(data.totalPage) > page)) return items;
      if (Number(data.totalPage) > 0 && page >= Number(data.totalPage)) return items;
    }
    throw Error('教务记录超过安全限制，未生成不完整统计');
  }
  async function run() {
    if (location.origin !== 'https://jw.qlu.edu.cn') throw Error('请在学校教务页面完成登录');
    let html = '', course_map = {};
    const planPage = location.pathname.endsWith('/jxzxjhck_cxJxzxjhckIndex.html');
    if (planPage) {
      try {
        // 先进入培养方案，等待页面自己的列表请求，与桌面端的响应监听一致。
        for (let attempt = 0; attempt < 3 && !window.__LUMATILE_PLAN_LIST__?.items; attempt++) await new Promise(resolve => setTimeout(resolve, 3500));
        const plans = window.__LUMATILE_PLAN_LIST__?.items || [];
        const id = plans[0]?.jxzxjhxx_id;
        if (!id) throw Error('培养方案列表缺少计划');
        html = await request('jxzxjhgl/jxzxjhck_cxJxzxjhxdyqIndex.html?jxzxjhxx_id=' + encodeURIComponent(id) + '&gnmkdm=N153540&layout=default');
        const starts = [...html.matchAll(/li id='li([0-9A-Fa-f]{32})'/g)];
        for (let index = 0; index < starts.length; index++) {
          const nodeId = starts[index][1];
          if (Object.prototype.hasOwnProperty.call(course_map, nodeId)) continue;
          const chunk = html.slice(starts[index].index, starts[index + 1]?.index ?? starts[index].index + 6000);
          const title = chunk.match(/id='p[0-9A-Fa-f]{32}'\s+yqzdxf='[\d.]+'\s*>([^<]*)/)?.[1] || '';
          if (!/思想政治理论|安全教育|艺术体育|四史|文化/.test(title)) continue;
          const type = chunk.match(/class='more' jdkcsx='([^']*)'/)?.[1] || '1';
          course_map[nodeId] = [];
          try {
            const courses = JSON.parse(await request('jxzxjhgl/jxzxjhxfyq_cxJxzxjhxfyqKcxx.html?gnmkdm=N153540', 'xfyqjd_id=' + nodeId + '&jdkcsx=' + encodeURIComponent(type)));
            if (!Array.isArray(courses)) throw Error('课程映射格式变化');
            for (const item of courses) {
              if (item && typeof item === 'object' && !Array.isArray(item)) course_map[nodeId].push({ code: edgeTrim(item.KCH || ''), name: edgeTrim(item.KCMC || '') });
            }
          } catch { warnings.push('部分官方课程映射未读取到，对应课程使用关键词归类，请核对结果。'); }
        }
      } catch { warnings.push('培养方案读取失败，使用内置 24/25 级要求与已保存的调整值。'); html = ''; course_map = {}; }
      await transfer({ html, course_map, items: [], warnings: [...new Set(warnings)] });
      return;
    }
    if (!location.pathname.endsWith('/cjcx_cxDgXscj.html') || !window.__LUMATILE_CREDIT_PLAN_READY__) throw Error('请先读取培养方案，再进入成绩查询');
    state.message = '正在读取全部学期成绩…';
    // 成绩页本身提供查询范围；不猜测用户的入学年份或学期代码。
    const yearOptions = [], semesters = [];
    for (const option of document.querySelectorAll('#xnm option')) if (/^\d+$/.test(option.value)) yearOptions.push(option.value);
    const years = yearOptions.sort((a,b) => Number(b) - Number(a)).slice(0,8);
    for (const option of document.querySelectorAll('#xqm option')) if (option.value) semesters.push(option.value);
    if (!years.length || !semesters.length) throw Error('成绩页面缺少学年或学期，请重新打开统计');
    const items = [], seen = new Set();
    for (const year of years) for (const semester of semesters) {
      state.message = '正在读取 ' + year + ' 学年（学期 ' + semester + '）成绩…';
      const batch = await query('cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005',
        'xnm=' + encodeURIComponent(year) + '&xqm=' + encodeURIComponent(semester) + '&sfzgcj=&kcbj=&pkey=&_search=false&nd=' + Date.now() + '&queryModel.sortName=+&queryModel.sortOrder=asc&time=0');
      for (const item of batch) {
        if (edgeTrim(item.cjsfzf || '') === '是') continue;
        const key = JSON.stringify([item.kch || item.kcmc || '', item.xnm || year, item.xqm || semester]);
        if (seen.has(key)) continue;
        seen.add(key); items.push(item);
      }
    }
    state.message = '正在读取最新学年的在修课程…';
    for (const semester of semesters) {
      try {
        const batch = await query('xkcx/xkmdcx_cxXkmdcxIndex.html?doType=query&gnmkdm=N255010',
          'xnm=' + encodeURIComponent(years[0]) + '&xqm=' + encodeURIComponent(semester) + '&kkxy_id=&kclbdm=&kcxzmc=&kch=&kklxdm=&kkzt=1&jxbmc=&jsxx=&kcgsdm=&xdbj=&fxbj=&cxbj=&zxbj=&sfzbh_kcflsj=&cxlx=&zyfx_id=&xklc=&xkly=&_search=false&nd=' + Date.now() + '&queryModel.sortName=xkbjmc%2Cxnmc%2Cxqmc%2Ckkxymc%2Ckch%2Cjxbmc%2Cxh+&queryModel.sortOrder=asc&time=0');
        for (const item of batch) {
          const key = JSON.stringify([item.kch || '', item.xnm || years[0], item.xqm || semester]);
          if (seen.has(key)) continue;
          seen.add(key); items.push({ kch: item.kch, kcmc: item.kcmc, xf: item.xf, cj: '', kclbmc: item.kclbmc, kcxzmc: item.kcxzmc, xnm: item.xnm || years[0], xqm: item.xqm || semester });
        }
      } catch { warnings.push('部分在修课程读取失败，在修学分与选课建议可能不完整，请核对学校选课名单。'); }
    }
    if (!items.length) throw Error('没有读取到任何成绩记录');
    await transfer({ html, course_map, items, warnings: [...new Set(warnings)] });
  }
  async function transfer(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (bytes.length > 20 * 1024 * 1024) throw Error('统计数据超过安全限制');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    state.base64 = btoa(binary);
    state.started = true;
    state.result = JSON.stringify({ ok: true, total: bytes.length, base64Length: state.base64.length, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('') });
  }
  run().catch(error => { state.result = JSON.stringify({ ok: false, message: state.message + '失败：' + String(error.message || error) }); });
  return true;
})()
