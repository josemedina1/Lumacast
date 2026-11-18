const { Tray, Menu } = require('electron');
function createTray(icon, { open, hide, quit }) {
  const tray = new Tray(icon);
  tray.setToolTip('LumaCast · Disponible en segundo plano');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir LumaCast', click: open },
    { label: 'Ocultar en la bandeja', click: hide },
    { type: 'separator' },
    { label: 'Salir de LumaCast', click: quit }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', open);
  return tray;
}
module.exports = { createTray };
