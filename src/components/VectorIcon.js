/**
 * Qavora Android — Cross-Platform Geometric Vector Icons (Phase 2B)
 *
 * Renders clean, scalable geometric vector icons using pure React Native View
 * primitives (strokes, arcs, polygons, and transforms) with zero external font
 * or native module dependencies and zero Unicode symbols.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function VectorIcon({
  name = 'folder',
  size = 18,
  color = '#6366f1',
  style,
}) {
  const stroke = Math.max(1.6, Math.round(size * 0.11 * 10) / 10);
  const boxStyle = [
    styles.container,
    { width: size, height: size },
    style,
  ];

  switch (name) {
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

    case 'close': {
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
