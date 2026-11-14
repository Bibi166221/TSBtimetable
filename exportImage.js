'use strict';
/*
 * Export the FULL timetable board as an SVG image, or rasterize it to a
 * 3x-resolution PNG. No external libraries, accounts, uploads, or servers.
 * Excludes navigation and controls. Reflows the board at a fixed desktop
 * width, so phone exports have the same crisp two-column layout.
 */
(() => {
  const BOARD_WIDTH = 1160;
  const SCALE = 3;
  const $ = (id) => document.getElementById(id);
  const pngButton = $('savePngBtn');
  const svgButton = $('saveSvgBtn');
  if (!pngButton || !svgButton) return;
  let busy = false;

  function notify(message) {
    const el = $('notice');
    if (el) el.textContent = message;
  }

  function safeFilename() {
    const route = String($('routeTitle')?.textContent || 'route')
      .replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_').slice(0, 65);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    return `TSB_${route}_${date}`;
  }

  function getStyles() {
    return [...document.styleSheets].map(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n'); }
      catch { return ''; }
    }).join('\n');
  }

  function getExportMarkup() {
    const source = document.querySelector('.station-sign');
    if (!source) throw new Error('Timetable board not found');
    if (!document.querySelector('#goBody .hour') && !document.querySelector('#backBody .hour')) {
      throw new Error('Load a timetable before saving an image');
    }
    // Use a temporary real DOM element to resolve width-dependent layout,
    // including all additional A/X/L/R panels below the two main panels.
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = `position:absolute;top:0;left:-20000px;width:${BOARD_WIDTH}px;visibility:hidden;pointer-events:none;z-index:-1;`;
    const clone = source.cloneNode(true);
    clone.classList.add('image-export-board');
    // Fixed desktop layout for measurement on phones as well as computers.
    const exportColumns = clone.querySelector('.dual-panels');
    if (exportColumns) exportColumns.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr)';
    const exportExtras = clone.querySelector('.extra-panels');
    if (exportExtras) exportExtras.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    holder.append(clone);
    document.body.append(holder);
    try {
      // Align the copied board too, even if the live page is stacked on a
      // phone. Exports always have two side-by-side timetable columns.
      const leftPanel = clone.querySelector('#goPanel');
      const rightPanel = clone.querySelector('#backPanel');
      const leftHeading = leftPanel?.querySelector('.column-head');
      const rightHeading = rightPanel?.querySelector('.column-head');
      if (leftHeading && rightHeading) {
        const aTop = leftHeading.getBoundingClientRect().top;
        const bTop = rightHeading.getBoundingClientRect().top;
        leftHeading.style.marginTop = rightHeading.style.marginTop = '0px';
        if (aTop < bTop) leftHeading.style.marginTop = `${Math.ceil(bTop-aTop)}px`;
        else if (bTop < aTop) rightHeading.style.marginTop = `${Math.ceil(aTop-bTop)}px`;
      }
      const leftRows = [...(leftPanel?.querySelectorAll('tbody tr') || [])];
      const rightRows = [...(rightPanel?.querySelectorAll('tbody tr') || [])];
      for (const row of [...leftRows, ...rightRows]) row.style.height = '';
      for (let i = 0; i < Math.min(leftRows.length, rightRows.length); i++) {
        if (leftRows[i].dataset.serviceHour !== rightRows[i].dataset.serviceHour) continue;
        const height = Math.ceil(Math.max(leftRows[i].getBoundingClientRect().height, rightRows[i].getBoundingClientRect().height));
        leftRows[i].style.height = `${height}px`;
        rightRows[i].style.height = `${height}px`;
      }
      // A little extra room prevents clipping due to fractional pixel sizes.
      const height = Math.ceil(clone.getBoundingClientRect().height) + 3;
      const css = getStyles() + `\nhtml,body{margin:0!important;padding:0!important;background:#fff!important;}\n` +
        `.image-export-root{width:${BOARD_WIDTH}px!important;font-family:"Noto Sans Thai",Tahoma,Arial,sans-serif!important;}` +
        `.image-export-root .station-sign{box-shadow:none!important;margin:0!important;}` +
        `.image-export-root .dual-panels{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;}` +
        `.image-export-root .extra-panels{grid-template-columns:repeat(2,minmax(0,1fr))!important;}` +
        `.image-export-root .timetable-panel{break-inside:avoid;}` +
        `.image-export-root .source-link{font-size:10px!important;}`;
      // The copied CSS remains local; the entire exported file is self-contained.
      const wrapper = document.createElement('div');
      wrapper.className = 'image-export-root';
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      const style = document.createElement('style');
      style.textContent = css;
      wrapper.append(style, clone.cloneNode(true));
      const serialized = new XMLSerializer().serializeToString(wrapper);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_WIDTH}" height="${height}" viewBox="0 0 ${BOARD_WIDTH} ${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
      return {svg, width: BOARD_WIDTH, height};
    } finally {
      holder.remove();
    }
  }

  function saveBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    // Keep the URL alive long enough for Safari to start saving.
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }

  async function saveSvg() {
    const {svg} = getExportMarkup();
    saveBlob(new Blob([svg], {type:'image/svg+xml;charset=utf-8'}), safeFilename()+'.svg');
  }

  async function savePng() {
    const {svg,width,height} = getExportMarkup();
    const blob = new Blob([svg], {type:'image/svg+xml;charset=utf-8'});
    const src = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve,reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Browser could not render the timetable image'));
        img.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = width*SCALE;
      canvas.height = height*SCALE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const png = await new Promise((resolve,reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('PNG encoding failed')),'image/png'));
      saveBlob(png,safeFilename()+'.png');
      notify(`บันทึกภาพ PNG ความละเอียดสูง ${canvas.width} × ${canvas.height} px`);
    } finally { URL.revokeObjectURL(src); }
  }

  async function run(kind) {
    if (busy) return;
    busy=true;
    pngButton.disabled=svgButton.disabled=true;
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      if (kind==='svg') {
        await saveSvg();
        notify('บันทึกภาพ SVG แล้ว (ภาพเวกเตอร์ความละเอียดไม่จำกัด)');
      } else await savePng();
    } catch(err) {
      console.error('Image export failed:',err);
      notify(`ไม่สามารถบันทึกภาพได้: ${err.message} · ลองใช้ปุ่ม SVG`);
    } finally { busy=false; pngButton.disabled=svgButton.disabled=false; }
  }
  pngButton.addEventListener('click', () => run('png'));
  svgButton.addEventListener('click', () => run('svg'));
})();
