/**
 * wasavi: vi clone implemented in javascript
 *
 * @author akahuku@gmail.com
 */
/**
 * Copyright 2012-2014 akahuku, akahuku@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function (global) {
	'use strict';

	/* {{{1 consts */

	var TEST_MODE_URL = 'http://wasavi.appsweets.net/test_frame.html';
	var TEST_VERSION = '0.0.1';

	/* {{{1 variables */

	var wasaviFrameData, wasaviFrame;
	initWasaviFrame();

	var defaultFont = '"Consolas","Monaco","Courier New","Courier",monospace';
	var unicodeDictData;
	var payload;
	var config;
	var runtimeOverwriteSettings;
	var hotkey;
	var contextMenu;
	var storageUpdateTimer;
	var storageUpdatePayload = {};

	var ext = require('./kosian/Kosian').Kosian(global, {
		appName: 'wasavi',
		cryptKeyPath: 'LICENSE',
		writeDelaySecs: 1,
		fstab: {
			dropbox: {
				isDefault: true,
				enabled: true
			},
			gdrive: {
				enabled: true
			},
			onedrive: {
				enabled: true
			}
		},

		/*
		 * NOTE: The referencing way of key-hook script is
		 * different for every browser:
		 *
		 *   chrome:  scripts/key_hook.js, referenced via
		 *            chrome.runtime.getURL()
		 *
		 *   opera:   scripts/key_hook.js, referenced via
		 *            widget.preferences['keyHookScript']
		 *
		 *   firefox: data/scripts/key_hook.js,
		 *            keyHookScript property of following object
		 */
		contentScriptOptions: getContentScriptOptions(),

		/*
		 * NOTE: The place which lists the front-end scripts is
		 * different for every browser:
		 *
		 *   chrome:  manifest.json (app mode),
		 *            wasavi_frame.html (textarea mode)
		 *
		 *   opera:   a meta block in the each front-end script
		 *
		 *   firefox: following object
		 */
		contentScripts: getContentScriptsSpec()
	});

	var configInfo = {
		targets: {
			def: {
				enableTextArea:       true,
				enableText:           false,
				enableSearch:         false,
				enableTel:            false,
				enableUrl:            false,
				enableEmail:          false,
				enablePassword:       false,
				enableNumber:         false,
				enableContentEditable:true
			}
		},
		exrc: {
			def: '" exrc for wasavi'
		},
		shortcut: {
			def: function () {
				return hotkey.defaultHotkeysDesc;
			},
			set: function (value) {
				this.set(
					'shortcutCode',
					hotkey.getObjectsForDOM(value));
				return value;
			}
		},
		shortcutCode: {
			def: function () {
				return hotkey.getObjectsForDOM(this.get('shortcut'));
			}
		},
		fontFamily: {
			def: defaultFont,
			set: function (value) {
				if (!/^\s*(?:"[^",;]+"|'[^',;]+'|[a-zA-Z-]+)(?:\s*,\s*(?:"[^",;]+"|'[^',;]+'|[a-zA-Z-]+))*\s*$/.test(value)) {
					value = defaultFont;
				}
				return value;
			}
		},
		fstab: {
			def: {
				dropbox:  {enabled:true, isDefault:true},
				gdrive:   {enabled:true},
				onedrive: {enabled:true}
			},
			set: function (value) {
				ext.fileSystem.setInfo(value);
				return value;
			},
			setOnInit: true
		},
		quickActivation: {
			def: false
		},
		logMode: {
			def: false,
			set: function (value) {
				ext.setLogMode(value);
				return value;
			},
			setOnInit: true
		}
	};

	/* {{{1 classes */

	function Config (info) {
		Object.defineProperty(this, 'info', {value:info});
		this.usedKeys_ = {};
		this.init();
	}

	Config.prototype = {
		init: function () {
			debugger;
			for (var key in this.info) {
				var item = this.info[key];
				var defaultValue = this.getDefaultValue(key);
				var currentValue = this.get(key);

				if (currentValue === undefined) {
					this.set(key, defaultValue);
					continue;
				}

				var defaultType = ext.utils.objectType(defaultValue);
				var currentType = ext.utils.objectType(currentValue);

				if (defaultType != currentType) {
					this.set(key, defaultValue);
					continue;
				}

				if (defaultType != 'Object') {
					if (item.setOnInit && item.set) {
						item.set.call(this, currentValue);
					}
					continue;
				}

				if (currentType == 'Object') {
					Object.keys(currentValue).forEach(function (key) {
						if (!(key in defaultValue)) {
							delete currentValue[key];
						}
					});
				}
				else {
					currentType = {};
				}

				Object.keys(defaultValue).forEach(function (key) {
					if (!(key in currentValue)) {
						currentValue[key] = defaultValue[key];
					}
				});

				this.set(key, currentValue);
			}
		},
		getDefaultValue: function (name) {
			var item = this.info[name];
			if (!item) return undefined;
			if (typeof item.def == 'function') {
				return item.def.call(this);
			}
			return item.def;
		},
		get: function (name) {
			var result = ext.storage.getItem(name);

			if (name in this.info && this.info[name].get) {
				result = this.info[name].get.call(this, result);
			}
		
			return result;
		},
		set: function (name, value) {
			if (name in this.info && this.info[name].set) {
				value = this.info[name].set.call(this, value);
			}

			this.usedKeys_[name] = 1;
			ext.storage.setItem(name, value);
		},
		clearUsedKeys: function () {
			this.usedKeys_ = {};
		},
		get usedKeys () {
			return Object.keys(this.usedKeys_);
		}
	};

	/* {{{1 functions */

	/** {{{2 utilities */

	function broadcastStorageUpdate (keys) {
		if (storageUpdateTimer) {
			ext.utils.clearTimeout(storageUpdateTimer);
		}

		keys.forEach(function (key) {
			storageUpdatePayload[key] = {
				key: key,
				value: ext.storage.getItem(key)
			};
		});

		storageUpdateTimer = ext.utils.setTimeout(function () {
			ext.broadcast({
				type: 'update-storage',
				items: storageUpdatePayload
			});
			storageUpdatePayload = {};
			storageUpdateTimer = null;
		}, 1000 * 3);
	}

	function getShrinkedCode (src) {
		// strip head comment
		var blankLine = src.indexOf('\n\n');
		if (blankLine >= 0) {
			src = src.substring(blankLine + 2);
		}

		// remove all newlines
		src = src.replace(/\n[\n\s]*/g, ' ');

		return src;
	}

	/** {{{2 returns frontend script list for firefox */

	function getContentScriptOptions () {
		var self = require('sdk/self');
		if (!self) return null;

		var base64 = require('sdk/base64');

		return {
			keyHookScript: 'data:text/javascript;base64,' +
				base64.encode(
					getShrinkedCode(
						self.data.load('scripts/key_hook.js')))
		};
	}

	function getContentScriptsSpec () {
		var self = require('sdk/self');
		if (!self) return null;

		return [
			{
				name: 'agent',
				matches: [
					'http://*',
					'https://*'
				],
				exclude_matches: [
					'http://wasavi.appsweets.net/',
					'https://ss1.xrea.com/wasavi.appsweets.net/',
					self.data.url('options.html') + '*',
					function (url) {
						return url.substring(0, 256) ==
							wasaviFrameData.substring(0, 256);
					}
				],
				js: [
					'frontend/extension_wrapper.js',
					'frontend/agent.js'
				],
				run_at: 'start'
			},
			{
				name: 'wasavi',
				matches: [
					'http://wasavi.appsweets.net/',
					'https://ss1.xrea.com/wasavi.appsweets.net/',
					function (url) {
						return url.substring(0, 256) ==
							wasaviFrameData.substring(0, 256);
					}
				],
				js: [
					'frontend/extension_wrapper.js',
					'frontend/init.js',
					'frontend/utils.js',
					'frontend/unicode_utils.js',
					'frontend/classes.js',
					'frontend/classes_ex.js',
					'frontend/classes_undo.js',
					'frontend/classes_subst.js',
					'frontend/classes_search.js',
					'frontend/classes_ui.js',
					'frontend/wasavi.js'
				],
				run_at: 'start'
			},
			{
				name: 'options',
				matches: [
					self.data.url('options.html') + '*'
				],
				js: [
					'frontend/extension_wrapper.js',
					'frontend/agent.js',
					'scripts/options-core.js'
				],
				run_at: 'start'
			}
		];
	}

	/** {{{2 init wasavi frame */

	function initWasaviFrame () {
		require('kosian/ResourceLoader')
		.ResourceLoader(global)
		.get('wasavi_frame.html', function (data) {
			if (typeof data != 'string' || data == '') {
				throw new Error('Invalid wasaviFrame');
			}

			wasaviFrameData = 'data:text/html;charset=UTF-8;base64,' +
				require('kosian/Utils').Utils.btoa(data);

			wasaviFrame = /<body[^>]*>([\s\S]+)<\/body>/
				.exec(data)[1]
				.replace(/\n/g, '')
				.replace(/>\s+</g, '><')
				.replace(/^\s+|\s+$/g, '');
		}, {noCache:true, sync:true});
	}

	/** {{{2 initialize f/F/t/T dictionary */

	function initUnicodeDictData () {
		unicodeDictData = {fftt:{}};

		function ensureBinaryString (data) {
			var buffer = [];
			for (var i = 0, goal = data.length; i < goal; i++) {
				buffer[i] = data.charCodeAt(i) & 0xff;
			}
			return String.fromCharCode.apply(null, buffer);
		}
		function handler (name1, name2) {
			return function (data) {
				data = ensureBinaryString(data);
				if (name1 && name2) {
					unicodeDictData[name1][name2] = data;
				}
				else if (name1) {
					unicodeDictData[name1] = data;
				}
			};
		}

		[
			['fftt_general.dat', 'fftt', 'General'],
			['fftt_han_ja.dat', 'fftt', 'HanJa'],
			['linebreak.dat', 'LineBreak']
		].forEach(function (arg) {
			var file = arg.shift();
			ext.resourceLoader.get(
				'unicode/' + file,
				handler.apply(null, arg),
				{noCache:true, mimeType:'text/plain;charset=x-user-defined'});
		});
	}

	/** {{{2 hotkey */

	function initHotkey () {
		hotkey.register(ext.storage.getItem('shortcut'));
		hotkey.onPress = handleHotkeyPress;
	}

	function handleHotkeyPress (hotkey) {
		ext.postMessage({type:'request-run'});
	}

	/** {{{2 request handlers */

	function handleInit (command, data, sender, respond) {
		var isInit = command.type == 'init';
		respond({
			extensionId: ext.id,
			tabId: sender,
			version: ext.version,
			devMode: ext.isDev,
			logMode: ext.logMode,
			testMode: data.url == TEST_MODE_URL,

			targets: ext.storage.getItem('targets'),
			exrc: ext.storage.getItem('exrc'),
			ros: payload && payload.url != TEST_MODE_URL ?
				runtimeOverwriteSettings.get(payload.url, payload.nodePath) :
				'',
			shortcut: ext.storage.getItem('shortcut'),
			shortcutCode: hotkey.canProcess ?
				null : hotkey.getObjectsForDOM(ext.storage.getItem('shortcut')),
			fontFamily: ext.storage.getItem('fontFamily'),
			quickActivation: ext.storage.getItem('quickActivation'),

			messageCatalog: command.type != 'init-agent' ?
				ext.messageCatalog : null,
			wasaviFrame: isInit ? wasaviFrame : null,
			fstab: isInit ? ext.fileSystem.getInfo() : null,
			unicodeDictData: isInit ? unicodeDictData : null,
			payload: payload || null
		});
		payload = null;
	}

	function handleTransfer (command, data, sender, respond) {
		ext.postMessage(data.to, data.payload);
	}

	function handleResetOptions (command, data, sender, respond) {
		ext.storage.clear();
		ext.fileSystem.clearCredentials();
		contextMenu.build(true);
		config.init();
		broadcastStorageUpdate(
			'targets exrc shortcut shortcutCode quickActivate'.split(' '));
	}

	function handleGetStorage (command, data, sender, respond) {
		if ('key' in data) {
			respond({
				key: data.key,
				value: ext.storage.getItem(data.key)
			});
		}
		else {
			respond({
				key: data.key,
				value: undefined
			});
		}
	}

	function handleSetStorage (command, data, sender, respond) {
		var items;

		if ('key' in data && 'value' in data) {
			items = [{key:data.key, value:data.value}];
		}
		else if ('items' in data) {
			items = data.items;
		}

		if (items) {
			config.clearUsedKeys();
			items.forEach(function (item) {
				if (!('key' in item)) return;
				if (!('value' in item)) return;
				config.set(item.key, item.value);
			});
			broadcastStorageUpdate(config.usedKeys);
		}
	}

	function handleRequestBell (command, data, sender, respond) {
		if ('file' in data) {
			ext.resourceLoader.get(data.file, function (data) {
				respond({
					data: data || ''
				});
			}, {sync:true});
		}
	}

	function handleOpenOptions (command, data, sender, respond) {
		ext.openTabWithFile('options.html');
	}

	function handleSetClipboard (command, data, sender, respond) {
		if ('data' in data) {
			ext.clipboard.set(data.data);
		}
	}

	function handleGetClipboard (command, data, sender, respond) {
		respond({data: ext.clipboard.get()});
	}

	function handlePushPayload (command, data, sender, respond) {
		payload = data;
	}

	function handleRequestWasaviFrame (command, data, sender, respond) {
		respond({data: wasaviFrameData});
	}

	function handleFsCtl (command, data, sender, respond) {
		var result = false;
		var path = data.path || '';

		switch (data.subtype) {
		case 'reset':
			ext.fileSystem.clearCredentials(data.name);
			break;

		case 'get-entries':
			ext.fileSystem.ls(
				path, null,
				{
					onload: function (data) {
						respond({data: data.contents});
					},
					onerror: function (error) {
						respond({data: null});
					}
				}
			);
			result = true;
			break;

		case 'chdir':
			if (path == '') {
				ext.postMessage(sender, {
					type:'fileio-chdir-response',
					internalId:command.internalId,
					requestNumber:command.requestNumber,
					data:null
				});
			}
			else {
				ext.fileSystem.ls(
					path, sender,
					{
						onresponse: function () {
							return true;
						},
						onload: function (data) {
							ext.postMessage(sender, {
								type:'fileio-chdir-response',
								internalId:command.internalId,
								requestNumber:command.requestNumber,
								data:data
							});
						},
						onerror: function (error) {
							ext.postMessage(sender, {
								type:'fileio-chdir-response',
								internalId:command.internalId,
								requestNumber:command.requestNumber,
								error:error
							});
						}
					}
				);
			}
			break;

		case 'read':
			if (path == '') break;
			ext.fileSystem.read(
				path, sender,
				{
					onresponse: function (d) {
						if (!d) return;
						d.internalId = command.internalId;
						if (d.type == 'fileio-read-response') {
							d.requestNumber = command.requestNumber;
						}
					}
				}
			);
			break;

		case 'write':
			if (path == '') break;
			ext.fileSystem.write(
				path, sender, data.value,
				{
					onresponse: function (d) {
						if (!d) return;
						d.internalId = command.internalId;
						if (d.type == 'fileio-write-response') {
							d.requestNumber = command.requestNumber;
						}
					}
				}
			);
			break;
		}

		return result;
	}

	function handleTerminated (command, data, sender, respond) {
		var payload = data.payload || {};

		if ('url' in payload && 'nodePath' in payload && 'ros' in payload) {
			runtimeOverwriteSettings.set(
				payload.url,
				payload.nodePath,
				payload.ros
			);
		}
		if (payload.isTopFrame) {
			ext.closeTab(sender);
		}
	}

	function handleDumpInternalIds (command, data, sender, respond) {
		if (!ext.logMode) return;
		var log =  ext.dumpInternalIds();
		log.push(
			'',
			'sender id: #' + sender,
			'  command: ' + JSON.stringify(command),
			'     data: ' + JSON.stringify(data));
		respond({log: log.join('\n')});
	}

	/** {{{2 request handler entry */

	var commandMap = {
		'init-agent':			handleInit,
		'init-options':			handleInit,
		'init':					handleInit,
		'transfer':				handleTransfer,
		'get-storage':			handleGetStorage,
		'set-storage':			handleSetStorage,
		'push-payload':			handlePushPayload,
		'request-wasavi-frame':	handleRequestWasaviFrame,
		'request-bell':			handleRequestBell,
		'set-clipboard':		handleSetClipboard,
		'get-clipboard':		handleGetClipboard,
		'reset-options':		handleResetOptions,
		'open-options':			handleOpenOptions,
		'fsctl':				handleFsCtl,
		'terminated':			handleTerminated,
		'dump-internal-ids':	handleDumpInternalIds
	};

	function handleRequest (command, data, sender, respond) {

		function res (arg) {
			if (respond) {
				try {
					respond(arg);
				}
				catch (e) {}
				respond = null;
			}
		}

		try {
			var lateResponse = false;

			if (command && data) {
				var handler = commandMap[command.type];
				if (handler) {
					lateResponse = handler(command, data, sender, res);
				}
			}
		}
		finally {
			!lateResponse && res();
			return lateResponse;
		}
	}

	/** {{{2 bootstrap */

	function handleLoad (e) {
		e && global.removeEventListener && global.removeEventListener(e.type, handleLoad, false);

		switch (ext.kind) {
		case 'Opera':
			ext.resource('scripts/key_hook.js', function (data) {
				widget.preferences['keyHookScript'] =
					'data:text/javascript;base64,' +
					btoa(getShrinkedCode(data));
			}, {noCache:true});
			break;
		}

		runtimeOverwriteSettings = require('./RuntimeOverwriteSettings').RuntimeOverwriteSettings();
		hotkey = require('./kosian/Hotkey').Hotkey();
		contextMenu = require('./ContextMenu').ContextMenu();

		initHotkey();
		initUnicodeDictData();

		config = new Config(configInfo);

		ext.receive(handleRequest);
		ext.isDev && ext.log(
			'!INFO: running with following filesystems: ',
			ext.fileSystem.getInfo()
				.filter(function (f) {return f.enabled})
				.map(function (f) {return f.name})
				.join(', ')
		);
	}

	global.addEventListener ?
		global.addEventListener('load', handleLoad, false) :
		handleLoad();

})(this);

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker :