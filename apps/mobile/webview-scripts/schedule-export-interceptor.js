(() => {
  if (window.__LUMATILE_SCHEDULE_IMPORT__?.installed) return true;
  const maxFileSize = 20 * 1024 * 1024;
  const state = window.__LUMATILE_SCHEDULE_IMPORT__ = { installed: true, started: false, result: null, base64: null };
  const fail = error => { state.result = JSON.stringify({ ok: false, message: String(error?.message || error) }); };
  const capture = async bytes => {
    try {
      if (!bytes.length || bytes.length > maxFileSize) throw Error('导出文件为空或超过安全限制');
      const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      state.base64 = btoa(binary);
      state.result = JSON.stringify({ ok: true, total: bytes.length, base64Length: state.base64.length, sha256 });
    } catch (error) { fail(error); }
  };
  const captureResponse = async response => {
    if (!response.ok) throw Error('教务系统导出失败（HTTP ' + response.status + '）');
    if (Number(response.headers.get('Content-Length')) > maxFileSize) throw Error('导出文件超过安全限制');
    await capture(new Uint8Array(await response.arrayBuffer()));
  };
  const install = win => {
    try { if (new URL(win.document.baseURI).origin !== location.origin) return; } catch { return; }
    try {
      if (win.__LUMATILE_SCHEDULE_FRAME__) return;
      win.__LUMATILE_SCHEDULE_FRAME__ = true;
      const isExport = value => {
        try {
          const url = new URL(value, win.document.baseURI);
          return url.origin === location.origin && url.pathname.endsWith('/kbcx/xskbcx_cxDcExcelXskb.html');
        } catch { return false; }
      };
      const originalFetch = win.fetch.bind(win);
      const submit = (form, submitter) => {
        const action = submitter?.hasAttribute('formaction') ? submitter.formAction : form.action;
        if (!isExport(action)) return false;
        if (!state.started) {
          state.started = true;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60000);
          const data = new URLSearchParams(new win.FormData(form));
          if (submitter?.name) data.append(submitter.name, submitter.value);
          const url = new URL(action, win.document.baseURI);
          const method = (submitter?.hasAttribute('formmethod') ? submitter.formMethod : form.method || 'get').toUpperCase();
          if (method === 'GET') for (const [key, value] of data) url.searchParams.append(key, value);
          originalFetch(url.toString(), { method, credentials: 'same-origin', body: method === 'GET' ? undefined : data, signal: controller.signal })
            .then(captureResponse).catch(fail).finally(() => clearTimeout(timer));
        }
        return true;
      };
      const originalSubmit = win.HTMLFormElement.prototype.submit;
      win.HTMLFormElement.prototype.submit = function() { if (!submit(this)) return originalSubmit.apply(this, arguments); };
      win.document.addEventListener('submit', event => {
        if (event.target instanceof win.HTMLFormElement && submit(event.target, event.submitter)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      win.fetch = function(input, init) {
        const take = isExport(typeof input === 'string' || input instanceof win.URL ? input : input.url) && !state.started;
        if (take) state.started = true;
        return originalFetch(input, init).then(response => {
          if (take) captureResponse(response.clone()).catch(fail);
          return response;
        }, error => { if (take) fail(error); throw error; });
      };
      const originalOpen = win.XMLHttpRequest.prototype.open;
      const originalSend = win.XMLHttpRequest.prototype.send;
      win.XMLHttpRequest.prototype.open = function(method, url) {
        this.__scheduleExport = isExport(url);
        return originalOpen.apply(this, arguments);
      };
      win.XMLHttpRequest.prototype.send = function() {
        if (this.__scheduleExport && !state.started) {
          state.started = true;
          if (!this.responseType || this.responseType === 'text') this.overrideMimeType('text/plain; charset=x-user-defined');
          this.addEventListener('load', async () => {
            try {
              if (this.status < 200 || this.status >= 300) throw Error('导出失败：HTTP ' + this.status);
              const bytes = this.response instanceof win.Blob ? new Uint8Array(await this.response.arrayBuffer())
                : this.response instanceof win.ArrayBuffer ? new Uint8Array(this.response)
                : Uint8Array.from(this.responseText, character => character.charCodeAt(0) & 255);
              await capture(bytes);
            } catch (error) { fail(error); }
          });
          for (const event of ['error', 'abort', 'timeout']) this.addEventListener(event, () => fail('课表网络请求未完成'));
        }
        return originalSend.apply(this, arguments);
      };
      const frames = () => {
        for (const frame of win.document.querySelectorAll('iframe,frame')) {
          try { install(frame.contentWindow); } catch {}
        }
      };
      win.document.addEventListener('load', frames, true);
      new win.MutationObserver(frames).observe(win.document, { childList: true, subtree: true });
      frames();
    } catch (error) { fail(error); }
  };
  install(window);
  return true;
})()
