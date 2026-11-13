import { mock } from 'bun:test';

globalThis.__DEV__ = false;

function createFakeDom() {
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = String(type);
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.defaultPrevented = false;
      this.cancelBubble = false;
      this.target = init.target || null;
      this.currentTarget = null;
      this.eventPhase = 0;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {
      this.cancelBubble = true;
    }
    stopImmediatePropagation() {
      this.cancelBubble = true;
    }
  }

  class FakeNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.childNodes = [];
      this.parentNode = null;
      this.style = {};
      this.attributes = new Map();
      this.eventListeners = new Map();
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }
    get ownerDocument() {
      return doc;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newChild, refChild) {
      if (!refChild) return this.appendChild(newChild);
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      const idx = this.childNodes.indexOf(refChild);
      newChild.parentNode = this;
      if (idx === -1) this.childNodes.push(newChild);
      else this.childNodes.splice(idx, 0, newChild);
      return newChild;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    addEventListener(type, fn) {
      if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
      this.eventListeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      const set = this.eventListeners.get(type);
      if (set) set.delete(fn);
    }
    dispatchEvent(event) {
      const evt = event || new FakeEvent('unknown', { bubbles: true });
      if (!evt.target) evt.target = this;
      let cur = this;
      while (cur) {
        evt.currentTarget = cur;
        const listeners = cur.eventListeners.get(evt.type);
        if (listeners) {
          for (const listener of [...listeners]) {
            if (typeof listener === 'function') {
              listener.call(cur, evt);
            } else if (listener && typeof listener.handleEvent === 'function') {
              listener.handleEvent(evt);
            }
          }
        }
        if (!evt.bubbles || evt.cancelBubble) break;
        cur = cur.parentNode;
      }
      return !evt.defaultPrevented;
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      this.childNodes = [];
      if (val !== '' && val !== null && val !== undefined) {
        this.appendChild(doc.createTextNode(String(val)));
      }
    }
  }

  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1, String(tagName).toUpperCase());
      this.tagName = this.nodeName;
      this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'id') this.id = String(v);
    }
    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
    }
    hasAttribute(k) {
      return this.attributes.has(k);
    }
    focus() {}
    blur() {}
  }

  class FakeText extends FakeNode {
    constructor(text) {
      super(3, '#text');
      this.nodeValue = String(text ?? '');
    }
    get data() {
      return this.nodeValue;
    }
    set data(v) {
      this.nodeValue = String(v ?? '');
    }
  }

  class FakeComment extends FakeNode {
    constructor(text) {
      super(8, '#comment');
      this.nodeValue = String(text ?? '');
    }
  }

  const doc = {
    nodeType: 9,
    nodeName: '#document',
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    defaultView: null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    createComment: (text) => new FakeComment(text),
    addEventListener: () => {},
    removeEventListener: () => {},
    get activeElement() {
      return doc.body;
    },
  };
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  return {
    document: doc,
    Event: FakeEvent,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLIFrameElement: FakeElement,
    Text: FakeText,
  };
}

export const dom = createFakeDom();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = dom.document;
globalThis.Node = dom.Node;
globalThis.Element = dom.Element;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.HTMLIFrameElement = dom.HTMLIFrameElement;
globalThis.Text = dom.Text;
if (typeof globalThis.Event === 'undefined') {
  globalThis.Event = dom.Event;
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'https://qavora.example.test' },
    HTMLIFrameElement: dom.HTMLIFrameElement,
  };
} else {
  globalThis.window.HTMLIFrameElement = dom.HTMLIFrameElement;
}
dom.document.defaultView = globalThis.window;
if (!globalThis.navigator) {
  globalThis.navigator = { onLine: true, product: 'Gecko' };
}

function createMemoryAsyncStorage() {
  const map = new Map();
  return {
    _map: map,
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, val) {
      map.set(key, String(val));
    },
    async removeItem(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}

export const memoryAsyncStorage = createMemoryAsyncStorage();
export const secureStoreMap = new Map();

export const secureStoreController = {
  available: true,
  availableQueue: [],
  failGet: null,
  failSet: null,
  failDelete: null,
  setCalls: [],
  getCalls: [],
  deleteCalls: [],
  reset() {
    this.available = true;
    this.availableQueue = [];
    this.failGet = null;
    this.failSet = null;
    this.failDelete = null;
    this.setCalls = [];
    this.getCalls = [];
    this.deleteCalls = [];
    secureStoreMap.clear();
  },
};

export const mockSecureStoreModule = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  isAvailableAsync: async () => {
    if (secureStoreController.availableQueue.length > 0) {
      const next = secureStoreController.availableQueue.shift();
      if (next instanceof Error) throw next;
      return Boolean(next);
    }
    if (secureStoreController.available instanceof Error) {
      throw secureStoreController.available;
    }
    return Boolean(secureStoreController.available);
  },
  getItemAsync: async (key, options) => {
    secureStoreController.getCalls.push({ key, options });
    if (secureStoreController.failGet) throw secureStoreController.failGet;
    return secureStoreMap.has(key) ? secureStoreMap.get(key) : null;
  },
  setItemAsync: async (key, val, options) => {
    secureStoreController.setCalls.push({ key, val: String(val), options });
    if (secureStoreController.failSet) throw secureStoreController.failSet;
    secureStoreMap.set(key, String(val));
  },
  deleteItemAsync: async (key, options) => {
    secureStoreController.deleteCalls.push({ key, options });
    if (secureStoreController.failDelete) throw secureStoreController.failDelete;
    secureStoreMap.delete(key);
  },
};

mock.module('@react-native-async-storage/async-storage', () => ({
  default: memoryAsyncStorage,
}));

mock.module('expo-secure-store', () => mockSecureStoreModule);

mock.module('@react-native-community/netinfo', () => ({
  default: {
    fetch: async () => ({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    }),
    addEventListener: () => () => {},
    refresh: async () => ({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    }),
  },
}));

mock.module('expo', () => ({
  requireNativeModule: () => ({}),
  EventEmitter: class EventEmitter {},
}));

mock.module('expo-modules-core', () => ({
  EventEmitter: class EventEmitter {},
  NativeModulesProxy: {},
  requireNativeModule: () => ({}),
}));

mock.module('expo-file-system', () => ({
  File: class FakeExpoFile {
    constructor(...parts) {
      this.uri = parts.join('/');
    }
    create() {}
    write() {}
    text() {
      return Promise.resolve('');
    }
  },
  Paths: { cache: '/tmp/', document: '/tmp/' },
  documentDirectory: '/tmp/',
  cacheDirectory: '/tmp/',
  writeAsStringAsync: async () => {},
  readAsStringAsync: async () => '',
  getInfoAsync: async () => ({ exists: false }),
}));

mock.module('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));

mock.module('expo-sharing', () => ({
  isAvailableAsync: async () => false,
  shareAsync: async () => {},
}));

export const splashScreenController = {
  preventCalls: 0,
  hideCalls: 0,
  setOptionsCalls: [],
  reset() {
    this.preventCalls = 0;
    this.hideCalls = 0;
    this.setOptionsCalls = [];
  },
};

mock.module('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => {
    splashScreenController.preventCalls += 1;
    return true;
  },
  hideAsync: async () => {
    splashScreenController.hideCalls += 1;
    return true;
  },
  setOptions: (opts) => {
    splashScreenController.setOptionsCalls.push(opts);
  },
}));

mock.module('expo-status-bar', () => ({
  StatusBar: () => null,
}));

mock.module('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement('div', null, children),
    SafeAreaView: ({ children }) => React.createElement('div', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

mock.module('react-native', () => {
  const React = require('react');
  const mapHostProps = (props) => {
    const {
      children,
      style: _style,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState: _accessibilityState,
      accessible: _accessible,
      testID,
      onPress,
      onChangeText,
      disabled,
      numberOfLines: _numberOfLines,
      ellipsizeMode: _ellipsizeMode,
      keyboardShouldPersistTaps: _keyboardShouldPersistTaps,
      showsVerticalScrollIndicator: _showsVerticalScrollIndicator,
      showsHorizontalScrollIndicator: _showsHorizontalScrollIndicator,
      contentContainerStyle: _contentContainerStyle,
      placeholderTextColor: _placeholderTextColor,
      activeOpacity: _activeOpacity,
      hitSlop: _hitSlop,
      ...rest
    } = props || {};
    const mapped = { ...rest };
    if (accessibilityLabel !== undefined) mapped['aria-label'] = accessibilityLabel;
    if (accessibilityRole !== undefined) mapped.role = accessibilityRole;
    if (testID !== undefined) mapped['data-testid'] = testID;
    if (disabled !== undefined) mapped.disabled = Boolean(disabled);
    if (typeof onPress === 'function' && !disabled) {
      mapped.onClick = (e) => onPress(e);
    }
    if (typeof onChangeText === 'function') {
      mapped.onChange = (e) => onChangeText(e?.target?.value ?? '');
    }
    return { children, mapped };
  };

  const Host = (tag) =>
    React.forwardRef((props, ref) => {
      const { children, mapped } = mapHostProps(props);
      return React.createElement(tag, { ...mapped, ref }, children);
    });

  return {
    Platform: { OS: 'android', select: (obj) => obj.android ?? obj.default },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
    Animated: {
      Value: class FakeAnimatedValue {
        constructor(v = 0) {
          this._value = v;
        }
        setValue(v) {
          this._value = v;
        }
        interpolate() {
          return this;
        }
      },
      timing: (val, cfg = {}) => ({
        start: (cb) => {
          if (val && typeof val.setValue === 'function' && cfg.toValue !== undefined) {
            val.setValue(cfg.toValue);
          }
          if (typeof cb === 'function') cb({ finished: true });
        },
        stop: () => {},
      }),
      View: Host('rn-animated-view'),
      Text: Host('rn-animated-text'),
    },
    PanResponder: {
      create: () => ({ panHandlers: {} }),
    },
    StyleSheet: {
      create: (styles) => styles,
      flatten: (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s || {}),
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Keyboard: {
      addListener: () => ({ remove: () => {} }),
      dismiss: () => {},
      isVisible: () => false,
    },
    BackHandler: {
      addEventListener: () => ({ remove: () => {} }),
    },
    Share: {
      share: async () => ({ action: 'sharedAction' }),
    },
    Linking: {
      canOpenURL: async () => true,
      openURL: async () => {},
    },
    View: Host('rn-view'),
    Text: Host('rn-text'),
    TextInput: Host('rn-textinput'),
    Pressable: Host('rn-pressable'),
    TouchableOpacity: Host('rn-touchable'),
    ScrollView: Host('rn-scrollview'),
    RefreshControl: Host('rn-refreshcontrol'),
    KeyboardAvoidingView: Host('rn-kav'),
    ActivityIndicator: Host('rn-spinner'),
    Modal: ({ visible = true, children }) =>
      visible ? React.createElement('rn-modal', null, children) : null,
    FlatList: ({ data = [], renderItem, ListEmptyComponent, ListHeaderComponent, keyExtractor }) =>
      React.createElement(
        'rn-flatlist',
        null,
        ListHeaderComponent || null,
        Array.isArray(data) && data.length > 0
          ? data.map((item, index) =>
              React.createElement(
                React.Fragment,
                { key: keyExtractor ? keyExtractor(item, index) : String(index) },
                renderItem({ item, index })
              )
            )
          : ListEmptyComponent || null
      ),
    SectionList: ({ sections = [], renderItem, renderSectionHeader, ListEmptyComponent }) =>
      React.createElement(
        'rn-sectionlist',
        null,
        Array.isArray(sections) && sections.length > 0
          ? sections.map((section, sIdx) =>
              React.createElement(
                React.Fragment,
                { key: String(sIdx) },
                renderSectionHeader ? renderSectionHeader({ section }) : null,
                (section.data || []).map((item, idx) =>
                  React.createElement(
                    React.Fragment,
                    { key: `${sIdx}-${idx}` },
                    renderItem({ item, index: idx, section })
                  )
                )
              )
            )
          : ListEmptyComponent || null
      ),
  };
});

export function findElements(rootNode, predicate) {
  const matches = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1 && predicate(node)) {
      matches.push(node);
    }
    if (Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  }
  walk(rootNode);
  return matches;
}

export function triggerPress(node) {
  if (!node) {
    throw new Error('Cannot press null/undefined element');
  }
  const evt = new dom.Event('click', { bubbles: true, cancelable: true, target: node });
  node.dispatchEvent(evt);
}

export async function createRenderHarness() {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = React;
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container);

  return {
    container,
    root,
    async render(element) {
      await act(async () => {
        root.render(element);
      });
    },
    async press(node) {
      await act(async () => {
        triggerPress(node);
      });
    },
    async flush(ms = 20) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    },
    findByAttr(attrName, attrValue) {
      return findElements(
        container,
        (el) => el.getAttribute(attrName) === String(attrValue)
      );
    },
    findByText(textSubstring, tagFilter = null) {
      const needle = String(textSubstring);
      return findElements(container, (el) => {
        if (tagFilter && el.tagName !== tagFilter.toUpperCase()) return false;
        return el.textContent.includes(needle);
      });
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

/**
 * Temporarily hides `window` and `document` so modules such as cookieManager
 * exercise their React Native (`isBrowserDomEnvironment() === false`) path.
 */
export async function runWithNativeRuntime(fn) {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  delete globalThis.window;
  delete globalThis.document;
  try {
    return await fn();
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
}
