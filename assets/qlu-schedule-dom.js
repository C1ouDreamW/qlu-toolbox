(() => {
  const state = window.__LUMATILE_QLU_SCHEDULE_DOM__ ||= { requested: false, result: null, error: '' };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const documents = () => {
    const found = [];
    const visit = doc => {
      if (!doc || found.includes(doc)) return;
      found.push(doc);
      for (const frame of doc.querySelectorAll('iframe,frame')) {
        try { visit(frame.contentDocument); } catch {}
      }
    };
    visit(document);
    return found;
  };
  const selectedText = (docs, selector) => {
    for (const doc of docs) {
      const select = doc.querySelector(selector);
      if (select) return clean(select.options?.[select.selectedIndex]?.text || select.value);
    }
    return '';
  };
  const term = docs => {
    const pageText = docs.map(doc => clean(doc.body?.innerText || doc.body?.textContent)).join(' ');
    const direct = pageText.match(/(20\d{2})\s*[-－—]\s*(20\d{2})\s*学年[^学期]{0,20}第?\s*([12一二])\s*学期/);
    const yearText = direct?.[0] || selectedText(docs, '#xnm');
    const yearMatch = yearText.match(/(20\d{2})\s*[-－—]\s*(20\d{2})/);
    const startYear = yearText.match(/20\d{2}/)?.[0];
    const academicYear = yearMatch ? `${yearMatch[1]}-${yearMatch[2]}`
      : startYear ? `${startYear}-${Number(startYear) + 1}` : '';
    const semesterText = direct?.[3] || selectedText(docs, '#xqm');
    const semester = semesterText.includes('二') || /(?:^|\D)2(?:\D|$)/.test(semesterText) || semesterText === '12' ? '2'
      : semesterText.includes('一') || /(?:^|\D)1(?:\D|$)/.test(semesterText) || semesterText === '3' ? '1' : '';
    return { academicYear, semester };
  };
  const extract = () => {
    const docs = documents();
    const records = [];
    const containers = new Set();
    const pendingItems = [];
    for (const doc of docs) {
      for (const table of doc.querySelectorAll('#table1')) {
        for (const title of table.querySelectorAll('td .title')) {
          const cell = title.closest('td');
          let container = title;
          while (container && container !== cell) {
            let scheduleMarker = false;
            for (const node of container.querySelectorAll('p [title],p [data-original-title]')) {
              const label = clean(node.getAttribute('title') || node.getAttribute('data-original-title'));
              if (label === '节/周' || label === '周/节') { scheduleMarker = true; break; }
            }
            if (scheduleMarker) break;
            container = container.parentElement;
          }
          if (container && container !== cell) containers.add(container);
        }
        let pending = '';
        for (const node of table.querySelectorAll('td,tr')) {
          const text = clean(node.innerText || node.textContent);
          if (/^其[他它]课程[：:]/.test(text) && (!pending || text.length < pending.length)) pending = text;
        }
        if (pending) {
          for (const item of pending.replace(/^其[他它]课程[：:]\s*/, '').split(/[;；]/)) {
            const value = clean(item);
            if (value) pendingItems.push(value);
          }
        }
      }
    }
    for (const container of containers) {
      const cell = container.closest('td');
      const id = cell?.id || '';
      const weekday = Number(id.match(/^(?:td_)?([1-7])(?:-|$)/)?.[1]);
      const fields = {};
      for (const paragraph of container.querySelectorAll('p')) {
        const marker = [...paragraph.querySelectorAll('[title],[data-original-title]')].find(node => {
          const label = clean(node.getAttribute('title') || node.getAttribute('data-original-title'));
          return ['节/周','周/节','上课地点','教师','选课备注','学分','教学班','课程代码'].includes(label);
        });
        const label = clean(marker?.getAttribute('title') || marker?.getAttribute('data-original-title'));
        if (label) fields[label] = clean(paragraph.innerText || paragraph.textContent);
      }
      records.push({
        name: clean(container.querySelector('.title')?.innerText || container.querySelector('.title')?.textContent),
        weekday,
        scheduleText: fields['节/周'] || fields['周/节'] || '',
        location: fields['上课地点'] || '',
        teacherText: fields['教师'] || '',
        creditText: fields['学分'] || '',
        note: fields['选课备注'] || '',
        teachingClass: fields['教学班'] || '',
        code: fields['课程代码'] || '',
        rawText: clean(container.innerText || container.textContent).slice(0, 500),
      });
    }
    const metadata = term(docs);
    const invalid = records.find(record => !record.name || !Number.isInteger(record.weekday) || !record.scheduleText.includes('周') || !record.scheduleText.includes('节'));
    if (!records.length) throw Error('当前页面没有找到可导入的课程，请先选择学年、学期并查询');
    if (!metadata.academicYear || !metadata.semester) throw Error('无法识别当前课表的学年或学期');
    if (invalid) throw Error(`课程块结构不完整：${invalid.rawText || invalid.name || '未知课程'}`);
    return { ...metadata, candidateCount: containers.size, records, pendingItems: [...new Set(pendingItems)] };
  };
  const run = () => {
    state.requested = true;
    state.error = '';
    try { state.result = extract(); }
    catch (error) { state.result = null; state.error = String(error?.message || error); }
  };
  if (window.__LUMATILE_QLU_DOM_FORCE__) {
    window.__LUMATILE_QLU_DOM_FORCE__ = false;
    run();
  }
  if (!window.__LUMATILE_QLU_DOM_NATIVE__ && document.body && !document.getElementById('__lumatile_import_schedule')) {
    const button = document.createElement('button');
    button.id = '__lumatile_import_schedule';
    button.type = 'button';
    button.textContent = '导入当前课表到一格有光';
    button.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:13px 20px;border:0;border-radius:999px;background:#0758b8;color:#fff;font:600 15px sans-serif;box-shadow:0 6px 22px #0003;cursor:pointer';
    button.addEventListener('click', () => {
      run();
      button.textContent = state.result ? '已读取，正在导入…' : '读取失败，请用输出EXCEL';
    });
    document.body.appendChild(button);
  }
  return JSON.stringify({ requested: state.requested, result: state.result, error: state.error });
})()
