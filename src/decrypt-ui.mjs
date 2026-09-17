export async function decryptDialog({ S, modal, closeModal, choose, writeFile, rpc, settings, toast, setCleanup }) {
  if (!window.desktop?.qpdf) throw Error('请使用包含 qpdf 引擎的完整便携包');
  let file = null, closed = false, busy = false;
  const $ = s => document.querySelector(s);
  modal('导出无密码副本', `<p>在本机使用 qpdf 移除 PDF 加密，保留页面、书签和矢量内容。</p>
    <label>文件来源<select id="decrypt-source"><option value="pick">选择 PDF 文件</option>${S.pdf ? '<option value="original">当前文档的原始文件</option><option value="current">当前文档（包含已应用修改）</option>' : ''}</select></label>
    <button id="decrypt-pick">选择文件…</button><p id="decrypt-file">尚未选择文件</p>
    <label>文档密码<input id="decrypt-password" type="password" autocomplete="off" placeholder="无打开密码的文档可留空"></label>
    <p class="hint">密码仅用于本次操作。另存为副本，原文件保持不变。含数字签名的文件在重写后需要重新签署。</p><p id="decrypt-status" role="status"></p>`, [
      { text:'取消', run:closeModal },
      { text:'导出副本', primary:true, id:'decrypt-export', run:async () => {
        if (busy) return;
        const source = $('#decrypt-source').value;
        let password = $('#decrypt-password').value;
        $('#decrypt-password').value = '';
        busy = true; $('#decrypt-export').disabled = true;
        try {
          let bytes, name, handle;
          if (source === 'pick') { if (!file) throw Error('请先选择文件'); ({bytes,name,handle}=file); }
          else {
            await S.flowEdit?.flush();
            if (closed) return;
            name=S.name; handle=S.handle;
            bytes=source === 'original' ? S.bytes : await rpc('save', {
              contentBytes: S.nativeEdits.length || S.ocr.length ? await S.pdf.getData() : null,
              nodes:S.nodes, rotations:S.rotation, annotations:S.annotations, metadata:S.metadata, showBookmarks:settings.showBookmarks });
          }
          $('#decrypt-status').textContent='正在解密并校验…';
          const result=await window.desktop.qpdf({command:'qpdf-decrypt',bytes,password}); password=null;
          if (closed) return;
          if (result.needsPassword) throw Error('密码不正确或尚未输入，请重试');
          if (result.signed && !window.confirm('此 PDF 含数字签名。导出的副本会改变签名有效性，是否继续另存？')) return;
          const saved=await window.desktop.save({name:name.replace(/\.pdf$/i,'')+'-decrypted.pdf',kind:'pdf',bytes:result.bytes,handle,forceAs:true,protect:true,working:false});
          if (closed) return;
          $('#decrypt-status').textContent=saved ? `已导出 ${result.pages} 页无密码副本（qpdf ${result.engineVersion}）` : '已取消保存';
          if (saved) toast('无密码副本已保存');
        } catch(e) { if (!closed) $('#decrypt-status').textContent=e.message; }
        finally { password=null; busy=false; if (!closed) $('#decrypt-export').disabled=false; }
      } }
    ]);
  $('#decrypt-pick').onclick=async()=>{ const selected=await choose('pdf'); if (!closed && selected) {file=selected;$('#decrypt-file').textContent=selected.name;} };
  $('#decrypt-source').onchange=()=>{ $('#decrypt-pick').hidden=$('#decrypt-source').value!=='pick'; $('#decrypt-file').textContent=$('#decrypt-source').value==='pick' ? file?.name||'尚未选择文件' : S.name; };
  setCleanup(()=>{closed=true;file=null;window.desktop.cancelQpdf();});
}
