(() => {
  const config = window.__LUMATILE_GRADE_EXPORT_CONFIG__;
  if (!config) return false;
  delete window.__LUMATILE_GRADE_EXPORT_CONFIG__;
  const { taskId, academicYear, semester, exportUrl, columns, maxFileSize } = config;
  const root = window.__LUMATILE_GRADE_EXPORT__ || (window.__LUMATILE_GRADE_EXPORT__ = {});
  root[taskId] = { result: null, base64: null };
  (async () => {
    try {
      const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const until = async (test, timeout) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (test()) return true;
          await sleep(250);
        }
        return false;
      };
      if (!await until(() => document.querySelector('#xnm') && document.querySelector('#xqm'), 30000)) {
        return JSON.stringify({ ok: false, code: 'PAGE_CHANGED', message: '成绩页面缺少学年或学期控件' });
      }
      const year = document.querySelector('#xnm');
      const term = document.querySelector('#xqm');
      if (!await until(() => year.options.length > 1 && term.options.length > 1, 30000)) {
        return JSON.stringify({ ok: false, code: 'PAGE_CHANGED', message: '学年或学期选项加载超时' });
      }
      const schoolYear = academicYear + '-' + (Number(academicYear) + 1);
      const yearOption = Array.from(year.options).find(option => option.value === academicYear)
        || Array.from(year.options).find(option => (option.textContent || '').includes(schoolYear));
      const termNumber = semester === '3' ? '1' : '2';
      const termName = semester === '3' ? '第一' : '第二';
      const exactTermOption = Array.from(term.options).find(option => option.value === semester);
      const termPattern = new RegExp('(^|\\D)' + termNumber + '(\\D|$)');
      const termOption = exactTermOption || Array.from(term.options).find(option => {
        const text = (option.textContent || '').trim();
        return text.includes(termName) || termPattern.test(text);
      });
      if (!yearOption) return JSON.stringify({ ok: false, code: 'SEMESTER_MISMATCH', message: '成绩页面中没有 ' + schoolYear + ' 学年' });
      if (!termOption) return JSON.stringify({ ok: false, code: 'SEMESTER_MISMATCH', message: '成绩页面中没有所选学期' });
      const selectedYear = yearOption.value;
      const selectedTerm = termOption.value;
      year.value = selectedYear;
      term.value = selectedTerm;
      year.dispatchEvent(new Event('change', { bubbles: true }));
      term.dispatchEvent(new Event('change', { bubbles: true }));
      const search = document.querySelector('#search_go');
      if (!search) return JSON.stringify({ ok: false, code: 'PAGE_CHANGED', message: '成绩页面缺少查询按钮' });
      search.click();
      await sleep(800);
      await until(() => !window.jQuery || window.jQuery.active === 0, 15000);
      if (year.value !== selectedYear || term.value !== selectedTerm) {
        return JSON.stringify({ ok: false, code: 'SEMESTER_MISMATCH', message: '查询后学年或学期发生变化，已拒绝导出' });
      }
      const body = new URLSearchParams();
      body.append('gnmkdmKey', 'N305005');
      body.append('xnm', selectedYear);
      body.append('xqm', selectedTerm);
      body.append('dcclbh', 'JW_N305005_GLY');
      for (const column of columns) body.append('exportModel.selectCol', column);
      body.append('exportModel.exportWjgs', 'xls');
      body.append('fileName', '成绩单');
      const response = await fetch(exportUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
      });
      if (!response.ok) return JSON.stringify({ ok: false, code: 'EXPORT_HTTP_ERROR', message: '教务系统导出失败（HTTP ' + response.status + '）' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > maxFileSize) return JSON.stringify({ ok: false, code: 'FILE_TOO_LARGE', message: '导出文件为空或超过安全限制' });
      const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const base64 = btoa(binary);
      if (root[taskId]) root[taskId].base64 = base64;
      return JSON.stringify({ ok: true, total: bytes.length, base64Length: base64.length, sha256 });
    } catch (error) {
      return JSON.stringify({ ok: false, code: 'QUERY_FAILED', message: String(error && error.message || error) });
    }
  })().then(result => { if (root[taskId]) root[taskId].result = result; });
  return true;
})()
