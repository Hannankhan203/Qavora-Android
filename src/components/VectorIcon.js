/**
 * Qavora Android — Cross-Platform Geometric Vector Icons (Phase 2B)
 *
 * Renders clean, scalable geometric vector icons using pure React Native View
 * primitives (strokes, arcs, polygons, and transforms) with zero external font
 * or native module dependencies and zero Unicode symbols.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

export const SUPPORTED_VECTOR_ICON_NAMES = [
  'plus',
  'close',
  'x',
  'check',
  'check-circle',
  'chevron-right',
  'chevron-left',
  'chevron-down',
  'folder',
  'edit',
  'trash',
  'refresh',
  'search',
  'switch',
  'layers',
  'info',
  'alert',
  'alert-triangle',
  'share',
  'calendar',
  'globe',
  'tag',
  'flag',
  'file-text',
  'clipboard',
  'list',
  'menu',
  'dashboard',
  'grid',
  'play',
  'play-circle',
  'user',
  'sun',
  'moon',
];

export default function VectorIcon({
  name = 'folder',
  size = 18,
  color = '#6366f1',
  style,
}) {
  const normalizedName =
    typeof name === 'string' && name.trim()
      ? name.trim().toLowerCase()
      : 'folder';
  const stroke = Math.max(1.6, Math.round(size * 0.11 * 10) / 10);
  const boxStyle = [
    styles.container,
    { width: size, height: size },
    style,
  ];

  switch (normalizedName) {
    case 'plus': {
      const barLen = size * 0.68;
      return (
        <View style={boxStyle}>
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: barLen,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
        </View>
      );
    }

    case 'close':
    case 'x': {
      const barLen = size * 0.68;
      return (
        <View style={boxStyle}>
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      );
    }

    case 'check': {
      const w = size * 0.56;
      const h = size * 0.32;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: w,
              height: h,
              borderLeftWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{ rotate: '-45deg' }, { translateY: -size * 0.06 }],
            }}
          />
        </View>
      );
    }

    case 'check-circle': {
      const ring = size * 0.78;
      const w = size * 0.38;
      const h = size * 0.22;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: w,
                height: h,
                borderLeftWidth: stroke,
                borderBottomWidth: stroke,
                borderColor: color,
                transform: [{ rotate: '-45deg' }, { translateY: -size * 0.03 }],
              }}
            />
          </View>
        </View>
      );
    }

    case 'chevron-right': {
      const arm = size * 0.38;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: arm,
              height: arm,
              borderTopWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateX: -size * 0.06 }],
            }}
          />
        </View>
      );
    }

    case 'chevron-left': {
      const arm = size * 0.38;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: arm,
              height: arm,
              borderBottomWidth: stroke,
              borderLeftWidth: stroke,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateX: size * 0.06 }],
            }}
          />
        </View>
      );
    }

    case 'chevron-down': {
      const arm = size * 0.38;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: arm,
              height: arm,
              borderBottomWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              transform: [{ rotate: '45deg' }, { translateY: -size * 0.06 }],
            }}
          />
        </View>
      );
    }

    case 'folder': {
      const w = size * 0.82;
      const h = size * 0.62;
      const tabW = size * 0.34;
      const tabH = size * 0.14;
      return (
        <View style={boxStyle}>
          <View style={{ width: w, height: h + tabH * 0.6, justifyContent: 'flex-end' }}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: tabW,
                height: tabH + stroke,
                borderTopLeftRadius: 3,
                borderTopRightRadius: 3,
                borderWidth: stroke,
                borderBottomWidth: 0,
                borderColor: color,
              }}
            />
            <View
              style={{
                width: w,
                height: h,
                borderRadius: 3,
                borderWidth: stroke,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'edit': {
      const shaftW = size * 0.64;
      const shaftH = size * 0.22;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: shaftW,
              height: shaftH,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: 2,
              transform: [{ rotate: '-45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: size * 0.12,
              left: size * 0.14,
              width: size * 0.72,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
        </View>
      );
    }

    case 'trash': {
      const bodyW = size * 0.56;
      const bodyH = size * 0.58;
      const lidW = size * 0.72;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: size * 0.28,
              height: stroke * 1.1,
              backgroundColor: color,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              marginBottom: 1,
            }}
          />
          <View
            style={{
              width: lidW,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              marginBottom: 1.5,
            }}
          />
          <View
            style={{
              width: bodyW,
              height: bodyH,
              borderWidth: stroke,
              borderTopWidth: 0,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
              borderColor: color,
              flexDirection: 'row',
              justifyContent: 'space-evenly',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: stroke * 0.85,
                height: bodyH * 0.55,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                width: stroke * 0.85,
                height: bodyH * 0.55,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
          </View>
        </View>
      );
    }

    case 'refresh': {
      const ring = size * 0.72;
      const tip = size * 0.22;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              borderRightColor: 'transparent',
              transform: [{ rotate: '-30deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: size * 0.14,
              right: size * 0.14,
              width: tip,
              height: tip,
              borderTopWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'search': {
      const lens = size * 0.56;
      const handle = size * 0.28;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: lens,
              height: lens,
              borderRadius: lens / 2,
              borderWidth: stroke,
              borderColor: color,
              transform: [
                { translateX: -size * 0.08 },
                { translateY: -size * 0.08 },
              ],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: handle,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              transform: [
                { translateX: size * 0.2 },
                { translateY: size * 0.2 },
                { rotate: '45deg' },
              ],
            }}
          />
        </View>
      );
    }

    case 'switch': {
      const barW = size * 0.68;
      const head = size * 0.22;
      return (
        <View style={boxStyle}>
          <View style={{ marginBottom: size * 0.18, justifyContent: 'center' }}>
            <View
              style={{
                width: barW,
                height: stroke,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                position: 'absolute',
                right: 0,
                width: head,
                height: head,
                borderTopWidth: stroke,
                borderRightWidth: stroke,
                borderColor: color,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </View>
          <View style={{ justifyContent: 'center' }}>
            <View
              style={{
                width: barW,
                height: stroke,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: 0,
                width: head,
                height: head,
                borderBottomWidth: stroke,
                borderLeftWidth: stroke,
                borderColor: color,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </View>
        </View>
      );
    }

    case 'layers': {
      const w = size * 0.66;
      const h = size * 0.42;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: 3,
              transform: [{ translateY: -size * 0.12 }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: w,
              height: h,
              borderBottomWidth: stroke,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              borderRadius: 3,
              transform: [{ translateY: size * 0.12 }],
            }}
          />
        </View>
      );
    }

    case 'info': {
      const ring = size * 0.78;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: stroke * 1.1,
                height: stroke * 1.1,
                borderRadius: stroke,
                backgroundColor: color,
                marginBottom: 2,
              }}
            />
            <View
              style={{
                width: stroke,
                height: ring * 0.34,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
          </View>
        </View>
      );
    }

    case 'alert': {
      const ring = size * 0.78;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: 4,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: stroke,
                height: ring * 0.36,
                backgroundColor: color,
                borderRadius: stroke,
                marginBottom: 2,
              }}
            />
            <View
              style={{
                width: stroke * 1.1,
                height: stroke * 1.1,
                borderRadius: stroke,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'alert-triangle': {
      const baseW = size * 0.78;
      const sideLen = size * 0.78;
      return (
        <View style={boxStyle}>
          {/* Top apex cap */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.12,
              width: stroke * 1.15,
              height: stroke * 1.15,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          {/* Left diagonal edge */}
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: sideLen,
              backgroundColor: color,
              borderRadius: stroke,
              transform: [
                { translateX: -size * 0.19 },
                { translateY: 0 },
                { rotate: '28.5deg' },
              ],
            }}
          />
          {/* Right diagonal edge */}
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: sideLen,
              backgroundColor: color,
              borderRadius: stroke,
              transform: [
                { translateX: size * 0.19 },
                { translateY: 0 },
                { rotate: '-28.5deg' },
              ],
            }}
          />
          {/* Bottom horizontal base */}
          <View
            style={{
              position: 'absolute',
              bottom: size * 0.13,
              width: baseW,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          {/* Exclamation stem */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.36,
              width: stroke,
              height: size * 0.23,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          {/* Exclamation dot */}
          <View
            style={{
              position: 'absolute',
              bottom: size * 0.23,
              width: stroke * 1.15,
              height: stroke * 1.15,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
        </View>
      );
    }

    case 'share': {
      const trayW = size * 0.74;
      const trayH = size * 0.42;
      const shaftH = size * 0.52;
      const arrowHead = size * 0.26;
      return (
        <View style={boxStyle}>
          {/* Open-top share tray at bottom */}
          <View
            style={{
              position: 'absolute',
              bottom: size * 0.12,
              width: trayW,
              height: trayH,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
              borderColor: color,
            }}
          />
          {/* Upward arrow shaft */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.14,
              width: stroke,
              height: shaftH,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          {/* Upward arrow head */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.15,
              width: arrowHead,
              height: arrowHead,
              borderTopWidth: stroke,
              borderLeftWidth: stroke,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );
    }

    case 'calendar': {
      const w = size * 0.76;
      const h = size * 0.68;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: w,
              height: h,
              borderRadius: 3,
              borderWidth: stroke,
              borderColor: color,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: '100%',
                height: h * 0.28,
                borderBottomWidth: stroke,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'globe': {
      const ring = size * 0.76;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                position: 'absolute',
                width: ring - stroke,
                height: stroke * 0.9,
                backgroundColor: color,
              }}
            />
            <View
              style={{
                width: ring * 0.48,
                height: ring - stroke,
                borderRadius: ring / 2,
                borderWidth: stroke * 0.85,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'tag': {
      const w = size * 0.66;
      const h = size * 0.46;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: 3,
              justifyContent: 'center',
              paddingLeft: 3,
              transform: [{ rotate: '-25deg' }],
            }}
          >
            <View
              style={{
                width: stroke * 1.2,
                height: stroke * 1.2,
                borderRadius: stroke,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'flag': {
      const poleH = size * 0.76;
      const flagW = size * 0.52;
      const flagH = size * 0.4;
      return (
        <View style={boxStyle}>
          <View
            style={{
              position: 'absolute',
              left: size * 0.2,
              top: size * 0.12,
              width: stroke,
              height: poleH,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: size * 0.2 + stroke * 0.5,
              top: size * 0.14,
              width: flagW,
              height: flagH,
              borderWidth: stroke,
              borderLeftWidth: 0,
              borderTopRightRadius: 2,
              borderBottomRightRadius: 2,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'file-text': {
      const w = size * 0.66;
      const h = size * 0.78;
      const lineW = w * 0.56;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: w,
              height: h,
              borderRadius: 3,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              gap: size * 0.11,
            }}
          >
            <View
              style={{
                width: lineW,
                height: stroke * 0.9,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                width: lineW,
                height: stroke * 0.9,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                width: lineW * 0.7,
                height: stroke * 0.9,
                backgroundColor: color,
                borderRadius: stroke,
                alignSelf: 'flex-start',
                marginLeft: w * 0.16,
              }}
            />
          </View>
        </View>
      );
    }

    case 'clipboard':
    case 'list': {
      const w = size * 0.68;
      const h = size * 0.76;
      const clipW = size * 0.34;
      const clipH = size * 0.14;
      const rowW = w * 0.58;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: clipW,
              height: clipH,
              borderWidth: stroke * 0.9,
              borderColor: color,
              borderRadius: 2,
              marginBottom: -stroke * 0.6,
              zIndex: 1,
            }}
          />
          <View
            style={{
              width: w,
              height: h,
              borderRadius: 3,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: size * 0.06,
              gap: size * 0.11,
            }}
          >
            <View
              style={{
                width: rowW,
                height: stroke * 0.9,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
            <View
              style={{
                width: rowW,
                height: stroke * 0.9,
                backgroundColor: color,
                borderRadius: stroke,
              }}
            />
          </View>
        </View>
      );
    }

    case 'menu': {
      const barW = size * 0.72;
      const gap = size * 0.16;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: barW,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              marginBottom: gap,
            }}
          />
          <View
            style={{
              width: barW,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
              marginBottom: gap,
            }}
          />
          <View
            style={{
              width: barW,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
        </View>
      );
    }

    case 'dashboard':
    case 'grid': {
      const cell = size * 0.31;
      const gap = size * 0.1;
      const cellRadius = Math.max(1.5, size * 0.08);
      return (
        <View style={boxStyle}>
          <View style={{ gap }}>
            <View style={{ flexDirection: 'row', gap }}>
              <View
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: cellRadius,
                  borderWidth: stroke,
                  borderColor: color,
                }}
              />
              <View
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: cellRadius,
                  borderWidth: stroke,
                  borderColor: color,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap }}>
              <View
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: cellRadius,
                  borderWidth: stroke,
                  borderColor: color,
                }}
              />
              <View
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: cellRadius,
                  borderWidth: stroke,
                  borderColor: color,
                }}
              />
            </View>
          </View>
        </View>
      );
    }

    case 'play':
    case 'play-circle': {
      const ring = size * 0.78;
      const arm = size * 0.24;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: arm,
                height: arm,
                borderTopWidth: stroke,
                borderRightWidth: stroke,
                borderColor: color,
                transform: [
                  { translateX: -size * 0.03 },
                  { rotate: '45deg' },
                ],
              }}
            />
          </View>
        </View>
      );
    }

    case 'user': {
      const head = size * 0.34;
      const bodyW = size * 0.66;
      const bodyH = size * 0.28;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: head,
              height: head,
              borderRadius: head / 2,
              borderWidth: stroke,
              borderColor: color,
              marginBottom: size * 0.06,
            }}
          />
          <View
            style={{
              width: bodyW,
              height: bodyH,
              borderTopLeftRadius: bodyW / 2,
              borderTopRightRadius: bodyW / 2,
              borderWidth: stroke,
              borderBottomWidth: 0,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'sun': {
      const core = size * 0.44;
      const ray = size * 0.76;
      return (
        <View style={boxStyle}>
          <View
            style={{
              position: 'absolute',
              width: ray,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: ray,
              backgroundColor: color,
              borderRadius: stroke,
            }}
          />
          <View
            style={{
              width: core,
              height: core,
              borderRadius: core / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'moon': {
      const outer = size * 0.68;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: stroke,
              borderColor: color,
              borderRightColor: 'transparent',
              transform: [{ rotate: '-35deg' }],
            }}
          />
        </View>
      );
    }

    default: {
      const ring = size * 0.6;
      return (
        <View style={boxStyle}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
