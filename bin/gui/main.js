const { remote, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const https = require('https');
var Themes = [];

function displayName(modInfo) {
    if (modInfo.options) {
        if (modInfo.options.guiName)
            return modInfo.options.guiName;
        if (modInfo.options.niceName)
            return modInfo.options.niceName;
    }

    return modInfo.rawName || modInfo.name;
}

jQuery.fx.off = true;

jQuery(($) => {
	// --------------------------------------------------------------------
	// ------------------------------ NAVBAR ------------------------------
	// --------------------------------------------------------------------
	$('.tab-link').mouseenter((e) => {
		$('#infotext').html(e.target.getAttribute('helptext'));
	});
	
	$('.tab-link').mouseleave(() => {
		$('#infotext').html('');
	});

	// --------------------------------------------------------------------
	// ----------------------------- MAIN ---------------------------------
	// --------------------------------------------------------------------
	$('#minimize-btn').click(() => {
		if(Settings.gui.minimizetotray) {
			remote.getCurrentWindow().hide();
		} else {
			remote.getCurrentWindow().minimize();
		}
	});

	$('#close-btn').click(() => {
		remote.getCurrentWindow().close();
	});

	$(document).on('auxclick', 'a', (e) => {
		if (e.which !== 2)
			return true;

		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		return false;
	});

	// Proxy control
	let ProxyRunning = false;
	let ProxyStarting = false;

	ipcRenderer.on('proxy running', (_, running) => {
		ProxyRunning = running;
		ProxyStarting = false;

		$('#startproxy').css('color', 'rgb(0, 204, 0)');
		$('#startproxy').css('color', ProxyRunning ? 'rgb(0, 204, 0)' : 'rgb(255, 0, 0)');
		$('#title-status').text(ProxyRunning ? 'Running' : 'Not Running');
	});

	function startProxy() {
		if(ProxyStarting || ProxyRunning)
			return;

		ProxyStarting = true;
		$('#startproxy').css('color', 'rgb(4, 150, 153)');
		ipcRenderer.send('start proxy');
	}

	function stopProxy() {
		if(!ProxyRunning)
			return;

		$('#startproxy').css('color', 'rgb(237, 233, 9)');
		ipcRenderer.send('stop proxy');
	}

	$('#startproxy').click(() => {
		if(ProxyRunning) {
			stopProxy();
		} else {
			startProxy();
		}
	});


	// -------------------------------------------------------------------
	// --------------------------- SETTINGS ------------------------------
	// -------------------------------------------------------------------

	let Settings = null;
	let settingsInitialized = false;

	$('#settings tr').click((e) => {
		let target = e.target;
		if(target.getAttribute('type') == 'checkbox') return true;

		while(target.nodeName.toLowerCase() != 'tr') target = target.parentElement;
		let checkBox = $($(target).children('td')[1]).children('input[type="checkbox"]')[0];
		if(checkBox) {
			checkBox.checked = !checkBox.checked;
			$(checkBox).trigger('change');
		}
	});

	$('#settings input[type="checkbox"]').change((e) => {
		if(e.target.getAttribute('gui')) {
			let Override = {};
        	Override[e.target.id] = e.target.checked;
        	Settings.gui = Object.assign(Settings.gui, Override);
		} else {
			let Override = {};
        	Override[e.target.id] = e.target.checked;
        	Settings = Object.assign(Settings, Override);
		}

		ipcRenderer.send('set config', Settings);
	});

	function updateSettings(first = false) {
		$.each($('#settings input[type="checkbox"]'), (i, e) => {
			if(e.getAttribute('gui')) {
				$('#' + e.id).prop('checked', Settings.gui[e.id]);
			} else {
				$('#' + e.id).prop('checked', Settings[e.id]);
			}


			let files = fs.readdirSync('./bin/gui/css/themes');

			Themes = [];
			$('#themes').empty();
			files.forEach((e) => {
				let extIndex = e.indexOf('.css');
				if(extIndex !== -1) {
					let themeName = e.substring(0, extIndex);
					Themes.push(themeName);
					$('#themes').append('<div id="theme_'+themeName+'" class="theme" style="background-color: '+themeName+';"></div>');
				}
			});

			if(first) {
				$('head').append(`<link rel="stylesheet" href="css/themes/${Themes.indexOf(Settings.gui.theme) < 0 ? Themes[0] : Settings.gui.theme}.css">`);
			}

			Themes.forEach(theme => {
				$(`#theme_${theme}`).click(() => {
					$('head>link').filter('[rel="stylesheet"]:last').remove();
					$('head').append(`<link rel="stylesheet" href="css/themes/${theme}.css">`);
        			Settings.gui = Object.assign(Settings.gui, {'theme': theme});
        			ipcRenderer.send('set config', Settings);
				});
			});
		});
	}

	ipcRenderer.on('set config', (_, newConfig) => {
		if(!settingsInitialized) {
			Settings = newConfig;
			updateSettings(true);
			settingsInitialized = true;
		} else {
			updateSettings();
			$('#container > div').hide();
			$('#settings').show();
		}
	});


	// --------------------------------------------------------------------
	// ----------------------------- TAB ----------------------------------
	// --------------------------------------------------------------------

	let tabEvents = {
		help: (e) => { shell.openExternal(remote.getGlobal('TeraProxy').SupportUrl); },
		modsfolder: (e) => { ipcRenderer.send('show mods folder'); },
		mods: (e) => { ipcRenderer.send('get mods'); },
		getmods: (e) => { ipcRenderer.send('get installable mods'); },
		settings: (e) => { ipcRenderer.send('get config'); }
	};

	$('[tabname]').click((e) => {
		let target = e.target;
		while(target.nodeName.toLowerCase() != 'li') target = target.parentElement;
		if(target.classList.contains('current')) return;

		let tab = target.getAttribute('tabname');
		if(tab && tabEvents[tab]) {
			if(!target.getAttribute('tabclickonly')) {
				$('#container > div').hide();
				$('#loading').show(() => {
					tabEvents[tab](target);
					$('[tabname]').removeClass('current');
					$(target).addClass('current');
				});
			} else {
				tabEvents[tab](target);
			}
		} else if(!target.getAttribute('tabclickonly') && tab) {
			$('[tabname]').removeClass('current');
			$(target).addClass('current');
			$('#container > div').hide();
			$('#' + tab).show();
		}
	});

	// --------------------------------------------------------------------
	// --------------------------- MOD TAB --------------------------------
	// --------------------------------------------------------------------

	let WaitingForModAction = false;
	let expandedMods = [];

	ipcRenderer.on('set mods', (_, modInfos) => {
		WaitingForModAction = false;

		let ModIndex = 0;
		$('#mods > div > ul').empty();
		modInfos.forEach(modInfo => {
			const escapedName = (ModIndex++).toString();
            const donationId = `moddonate-${escapedName}`;
            const uninstallId = `moduninstall-${escapedName}`;
            const infoId = `modinfo-${escapedName}`;
            const enabledId = `modenabled-${escapedName}`;
            const updateId = `modupdate-${escapedName}`;

			$('#mods > div > ul').append('<li class="mod" id="'+modInfo.name+'"><b>'+displayName(modInfo)+(modInfo.version ? '&nbsp;('+modInfo.version+')' : '')+'</b>'+(modInfo.author ? '<span class="right">by <span class="author">'+modInfo.author+'</span></span>' : '')+'<div class="description">'+(modInfo.description || '')+'<div class="right mod-options"><a class="fas fa-toggle-on toggle-mod '+(modInfo.disabled ? 'off' : 'on')+'" id="'+enabledId+'"></a><a class="fas fa-sync-alt sync-mod '+(modInfo.disableAutoUpdate ? 'off' : 'on')+'" id="'+updateId+'"></a>'+(modInfo.supportUrl ? '<a class="fas fa-info-circle info-mod" id="'+infoId+'"></a>' : '')+(modInfo.donationUrl ? '<a class="fas fa-donate donate-mod" id="'+donationId+'"></a>' : '')+(!modInfo.isCoreModule ? '<a class="fas fa-trash-alt delete-mod" id="'+uninstallId+'"></a></div>' : '')+'</div><div class="clear"</div></li>');

			$(`#${donationId}`).on('click', (event) => {
				event.preventDefault();
				shell.openExternal(modInfo.donationUrl);
				return false;
			});

			$(`#${infoId}`).on('click', (event) => {
				event.preventDefault();
				shell.openExternal(modInfo.supportUrl);
				return false;
			});

			$(`#${enabledId}`).on('click', (event) => {
				event.preventDefault();
				if (!WaitingForModAction) {
					ipcRenderer.send('toggle mod load', modInfo);
					WaitingForModAction = true;
				}
				return false;
			});

			$(`#${updateId}`).on('click', (event) => {
				event.preventDefault();
				if (!WaitingForModAction) {
					ipcRenderer.send('toggle mod autoupdate', modInfo);
					WaitingForModAction = true;
				}
				return false;
			});

			$(`#${uninstallId}`).on('click', (event) => {
				event.preventDefault();
				if(ProxyRunning) {
					ShowModal("You cannot uninstall mods while TERA Toolbox is running. Please stop it first!");
				} else if(!WaitingForModAction) {
					ipcRenderer.send('uninstall mod', modInfo);
					WaitingForModAction = true;
				}
				return false;
			});
		});

		$('.mod:not(.get)').click((e) => {
			let target = e.target;
			while(target.nodeName.toLowerCase() != 'li' && (target.nodeName.toLowerCase() == 'b' || target.nodeName.toLowerCase() == 'span' || (target.nodeName.toLowerCase() == 'div' && target.classList.contains('description')))) target = target.parentElement;

			if(expandedMods.indexOf(target.id) !== -1) {
				expandedMods.splice(expandedMods.indexOf(target.id), 1);
			} else {
				expandedMods.push(target.id);
			}

			$('.description', target).toggle();

		});

		$('#container > div').hide();
		$('#mods').show();

		for(let i in expandedMods) {
			$('#' + expandedMods[i] + ' > .description').show();
		}
	});

	// --------------------------------------------------------------------
	// ----------------------- MOD INSTALL TAB ----------------------------
	// --------------------------------------------------------------------

	let WaitingForModInstall = false;
	let InstallableModInfos = [];
	let InstallableModFilter = [];

	function matchesInstallableModFilter(modInfo) {
		if(!$('#mod-filter-net')[0].checked && (!modInfo.category || modInfo.category === 'network')) {
			return false;
		}
		if(!$('#mod-filter-client')[0].checked && modInfo.category === 'client') {
			return false;
		}

		return InstallableModFilter.length === 0 || InstallableModFilter.some(keyword => (modInfo.author && modInfo.author.toLowerCase().includes(keyword)) || (modInfo.description && modInfo.description.toLowerCase().includes(keyword)) || displayName(modInfo).toLowerCase().includes(keyword));
    }

    let installingCustom = '';

	function rebuildInstallableModsList() {
		let ModIndex = 0;
		$('#getmods > div > ul').empty();
		$('#getmods > div > ul').append('<li class="mod get"><b>Install a custom mod</b><div class="description">Provide a GitHub link to automatically download and install a custom mod.<div class="right mod-options"><a class="fas fa-cloud-download-alt" id="download-custom"></a></div></div></li>');
		$('#download-custom').click(() => {
			ShowModal('<center><a class="fas fa-exclamation-triangle warning" style="font-size: 36px;"></a><br><font class="warning" style="font-size: 12px">Installing custom mods may cause issues and is not recommended!!</font></center><br>GitHub URL:<br><input type="text" id="github-url" placeholder="https://github.com/user/mod"><br><button id="download-github">Download & Install</button>');
			
			$('#download-github').click(() => {
				https.get(($('#github-url').val().replace('github.com', 'raw.githubusercontent.com') + '/master/module.json'), (resp) => {
					let data = '';
					resp.on('data', (chunk) => {
						data += chunk;
					});
					resp.on('end', () => {
						let modInfo = JSON.parse(data);
						installingCustom = modInfo.name;
						ipcRenderer.send('install mod', modInfo);
						WaitingForModInstall = true;
					});
				}).on("error", (err) => {
					ShowModal('Error:<br>' + err.message);
				});
			});
		});

		InstallableModInfos.filter(modInfo => matchesInstallableModFilter(modInfo)).forEach(modInfo => {
			const installId = 'installablemodinstall-' + (ModIndex++);

			$('#getmods > div > ul').append('<li class="mod get"><b>'+displayName(modInfo)+(modInfo.version ? '&nbsp;('+modInfo.version+')' : '')+'</b>'+(modInfo.author ? '<span class="right">by <span class="author">'+modInfo.author+'</span></span>' : '')+'</b><div class="description">'+modInfo.description+'<div class="right mod-options"><a class="fas fa-cloud-download-alt" id="'+installId+'"></a></div></div></li>');
		
			$(`#${installId}`).click((e) => {
				if(ProxyRunning) {
					ShowModal("You cannot install modules while TERA Toolbox is running. Please stop it first!");
				} else if(!WaitingForModInstall) {
					ipcRenderer.send('install mod', modInfo);
					WaitingForModInstall = true;
				}
			});
		});

		$('#container > div').hide();
		$('#getmods').show();
	}

	$('#mod-filter').on('input', () => {
		InstallableModFilter = $('#mod-filter').val().split(',').map(x => x.trim().toLowerCase()).filter(x => x.length > 0);
		rebuildInstallableModsList();
	});

	$('#mod-filter-net, #mod-filter-client').change(() => {
		rebuildInstallableModsList();
	});

	ipcRenderer.on('set installable mods', (_, modInfos) => {
		if(installingCustom.length > 0) {
			ShowModal('<center>Installed ' + installingCustom + '</center>');
			installingCustom = '';
		}
		WaitingForModInstall = false;
		InstallableModInfos = modInfos;
		rebuildInstallableModsList();
	});

	// --------------------------------------------------------------------
	// --------------------------- LOG TAB --------------------------------
	// --------------------------------------------------------------------
	const LogTabName = 'log';

	function log(msg) {
		let timeStr = '';
		if(Settings.gui.logtimes) {
			const now = new Date();
			timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}] `;
		}

		msg = $('<div/>').text(`${timeStr}${msg}${msg[msg.length-1] !== '\n' ? '\n' : ''}`).html();

		const contents = $('#log-data');
		contents.append(msg);
		contents.scrollTop(contents[0].scrollHeight);
	}

	$('#clear-log-btn').click(() => {
		$('#log-data').text('');
	});

	ipcRenderer.on('log', (_, data) => {
		log(data.toString());
	});

	// --------------------------------------------------------------------
	// ---------------------------- MODAL BOX -----------------------------
	// --------------------------------------------------------------------
	function ShowModal(html) {
		$("#modalbox-body").html(html);
		$("#modalbox").css('display', 'flex');
	}

	$("#modalbox-close").click(() => {
		$("#modalbox").hide();
	});

	ipcRenderer.on('error', (_, error) => {
		ShowModal(error);
	});

	ipcRenderer.send('init');
});