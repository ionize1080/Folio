// Keep the current document intact until BOTH parsers accept the decrypted bytes.
// The regular parser stays strict; ignoreEncryption is not a decrypt operation.
export async function preparePDFOpen(bytes, { parse, unlock }) {
  try {
    return { ...(await parse(bytes)), bytes, openedEncrypted: false };
  } catch (error) {
    if (error.code !== 'PDF_ENCRYPTED') throw error;
  }
  const result = await unlock(bytes);
  if (result === null) return null;
  if (!result?.bytes?.length || result.needsPassword)
    throw Error('解密未完成，原文档保持不变');
  const plain = new Uint8Array(result.bytes);
  return { ...(await parse(plain)), bytes: plain, openedEncrypted: true, signed: !!result.signed };
}

export async function decryptForOpen({ bytes, name, modal, closeModal, setCleanup, setBusy }) {
  if (!window.desktop?.qpdf) throw Error('此文档已加密，请使用包含 qpdf 引擎的完整 1.1 便携版');
  setBusy(true, '正在检查文档密码…');
  // Permission-restricted PDFs with an empty user password open without a prompt.
  const first = await window.desktop.qpdf({ command: 'qpdf-decrypt', bytes, password: '' });
  if (!first.needsPassword) return first;
  return new Promise(resolve => {
    let closed = false, running = false;
    const $ = selector => document.querySelector(selector);
    const finish = result => {
      if (closed) return;
      closed = true;
      $('#open-password').value = '';
      setCleanup(null);
      closeModal();
      resolve(result);
    };
    const submit = async () => {
      if (closed || running) return;
      running = true;
      let password = $('#open-password').value;
      $('#open-password').value = '';
      $('#open-password-submit').disabled = true;
      $('#open-password-status').textContent = '正在验证密码并解密…';
      setBusy(true, '正在解密文档…');
      try {
        const result = await window.desktop.qpdf({ command: 'qpdf-decrypt', bytes, password });
        password = null;
        if (closed) return;
        if (result.needsPassword) {
          $('#open-password-status').textContent = '密码不正确，请重新输入。';
          $('#open-password').setAttribute('aria-invalid', 'true');
          $('#open-password').focus();
        } else finish(result);
      } catch (error) {
        if (!closed) $('#open-password-status').textContent = error.message;
      } finally {
        password = null;
        running = false;
        if (!closed) { $('#open-password-submit').disabled = false; setBusy(true, '等待文档密码…'); }
      }
    };
    modal('打开加密文档', `<p id="open-password-file"></p><label>文档密码<input id="open-password" type="password" autocomplete="off" maxlength="4096" aria-describedby="open-password-status"></label><p id="open-password-status" role="status">请输入打开此 PDF 所需的密码。</p><p class="hint">密码仅用于本次打开。原文件保持不变，首次保存将另存为无密码副本。</p>`, [
      { text: '取消', run: closeModal },
      { text: '打开文档', id: 'open-password-submit', primary: true, run: submit },
    ]);
    $('#open-password-file').textContent = name;
    $('#open-password').onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
    };
    $('#open-password').oninput = () => $('#open-password').removeAttribute('aria-invalid');
    setCleanup(() => {
      if (closed) return;
      closed = true;
      $('#open-password').value = '';
      if (running) window.desktop.cancelQpdf?.();
      resolve(null);
    });
    setBusy(true, '等待文档密码…');
    $('#open-password').focus();
  });
}
