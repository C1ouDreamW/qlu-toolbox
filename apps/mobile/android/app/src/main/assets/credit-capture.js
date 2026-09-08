(() => {
  if (window.__LUMATILE_SCHEDULE_IMPORT__?.installed) return true;
  const state = window.__LUMATILE_SCHEDULE_IMPORT__ = { installed: true, started: false, result: null, base64: null, message: '正在读取培养方案…' };
  const root = '/jwglxt/';
  const warnings = [];
  async function request(path, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(root + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}) }, body });
      if (!response.ok) throw Error('教务接口返回 HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw Error('教务响应超过安全限制');
      return text.replace(/^\uFEFF/, '').trim();
    } finally { clearTimeout(timer); }
  }
  async function query(path, body) {
    const items = [];
    for (let page = 1; page <= 20; page++) {
      const data = JSON.parse(await request(path, body + '&queryModel.showCount=1000&queryModel.currentPage=' + page));
      if (!data || !Array.isArray(data.items) || data.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw Error('教务数据格式变化或登录已失效，请重新登录');
      items.push(...data.items);
      if (data.items.length < 1000 && !(Number(data.totalPage) > page)) return items;
      if (Number(data.totalPage) > 0 && page >= Number(data.totalPage)) return items;
    }
    throw Error('教务记录超过安全限制，未生成不完整统计');
  }
  async function run() {
    if (location.origin !== 'https://jw.qlu.edu.cn') throw Error('请在学校教务页面完成登录');
    let html = '', course_map = {};
    try {
      const plans = await query('jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html?doType=query&gnmkdm=N153540', '_search=false&queryModel.sortName=&queryModel.sortOrder=asc');
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
          const courses = JSON.parse(await request('jxzxjhgl/jxzxjhxfyq_cxJxzxjhxfyqKcxx.html', 'xfyqjd_id=' + nodeId + '&jdkcsx=' + encodeURIComponent(type)));
          if (!Array.isArray(courses)) throw Error('课程映射格式变化');
          course_map[nodeId] = courses.filter(item => item && typeof item === 'object').map(item => ({ code: String(item.KCH || '').trim(), name: String(item.KCMC || '').trim() }));
        } catch { warnings.push('部分官方课程映射未读取到，对应课程使用关键词归类，请核对结果。'); }
      }
    } catch { warnings.push('培养方案读取失败，使用内置 24/25 级要求与已保存的调整值。'); html = ''; course_map = {}; }
    state.message = '正在读取全部学期成绩…';
    // 成绩页本身提供查询范围；不猜测用户的入学年份或学期代码。
    const years = [...document.querySelectorAll('#xnm option')].map(option => option.value).filter(value => /^\d+$/.test(value)).sort((a,b) => Number(b) - Number(a)).slice(0,8);
    const semesters = [...document.querySelectorAll('#xqm option')].map(option => option.value).filter(Boolean);
    if (!years.length || !semesters.length) throw Error('成绩页面缺少学年或学期，请重新打开统计');
    const items = [], seen = new Set();
    for (const year of years) for (const semester of semesters) {
      state.message = '正在读取 ' + year + ' 学年（学期 ' + semester + '）成绩…';
      const batch = await query('cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005',
        'xnm=' + encodeURIComponent(year) + '&xqm=' + encodeURIComponent(semester) + '&sfzgcj=&kcbj=&pkey=&_search=false&nd=' + Date.now() + '&queryModel.sortName=+&queryModel.sortOrder=asc&time=0');
      for (const item of batch) {
        if (String(item.cjsfzf || '').trim() === '是') continue;
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
    const bytes = new TextEncoder().encode(JSON.stringify({ html, course_map, items, warnings: [...new Set(warnings)] }));
    if (bytes.length > 20 * 1024 * 1024) throw Error('统计数据超过安全限制');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    state.base64 = btoa(binary);
    state.started = true;
    state.result = JSON.stringify({ ok: true, total: bytes.length, base64Length: state.base64.length, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('') });
  }
  run().catch(error => { state.result = JSON.stringify({ ok: false, message: String(error.message || error) }); });
  return true;
})()
