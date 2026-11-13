import { describe, it, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

const { getConfig } = require('@expo/config');
const { getPrebuildConfigAsync } = require('@expo/prebuild-config');
const { compileModsAsync, XML } = require('expo/config-plugins');
const withAndroidBackupProtection = require('../plugins/withAndroidBackupProtection.js');

const {
  BACKUP_DOMAINS,
  BACKUP_RULES_FILE_NAME,
  DATA_EXTRACTION_RULES_FILE_NAME,
  BACKUP_RULES_RESOURCE,
  DATA_EXTRACTION_RULES_RESOURCE,
  applyAndroidBackupManifestAttributes,
} = withAndroidBackupProtection;

const tempDirs = [];

function createTempAndroidTemplateProject(initialManifestXml) {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qavora-android-backup-test-')
  );
  tempDirs.push(tmpDir);

  const androidAppMainDir = path.join(tmpDir, 'android', 'app', 'src', 'main');
  const javaPackageDir = path.join(
    androidAppMainDir,
    'java',
    'com',
    'qavora',
    'android'
  );
  fs.mkdirSync(javaPackageDir, { recursive: true });
  fs.writeFileSync(
    path.join(javaPackageDir, 'MainApplication.kt'),
    'package com.qavora.android\nclass MainApplication\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(javaPackageDir, 'MainActivity.kt'),
    'package com.qavora.android\nclass MainActivity\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(androidAppMainDir, 'AndroidManifest.xml'),
    initialManifestXml,
    'utf8'
  );

  return { tmpDir, androidAppMainDir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HIGH-04 — Android Backup Data Protection', () => {
  it('configures app.json to disable Android Auto Backup, delegate backup rules from expo-secure-store, and register withAndroidBackupProtection', () => {
    const rawAppJson = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')
    );

    expect(rawAppJson.expo.android.allowBackup).toBe(false);
    expect(rawAppJson.expo.android.package).toBe('com.qavora.android');

    const secureStorePluginEntry = rawAppJson.expo.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-secure-store'
    );
    expect(secureStorePluginEntry).toBeTruthy();
    expect(secureStorePluginEntry[1]).toEqual({
      configureAndroidBackup: false,
    });

    expect(rawAppJson.expo.plugins).toContain(
      './plugins/withAndroidBackupProtection'
    );

    const publicConfig = getConfig(PROJECT_ROOT, {
      skipSDKVersionRequirement: true,
    });
    expect(publicConfig.exp.android.allowBackup).toBe(false);
  });

  it('compiles Expo Android prebuild manifest and XML rules without expo-secure-store backup conflicts or warnings', async () => {
    const warnMessages = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnMessages.push(args.map((a) => String(a)).join(' '));
    };

    try {
      const { exp } = await getPrebuildConfigAsync(PROJECT_ROOT, {
        platforms: ['android'],
      });

      expect(exp.android.allowBackup).toBe(false);
      expect(exp._internal.pluginHistory['expo-secure-store']).toBeTruthy();
      expect(
        exp._internal.pluginHistory['qavora-android-backup-protection']
      ).toBeTruthy();

      const { tmpDir, androidAppMainDir } = createTempAndroidTemplateProject(
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools" package="com.qavora.android">
  <application android:name=".MainApplication" android:allowBackup="true" android:fullBackupContent="@xml/secure_store_backup_rules" android:dataExtractionRules="@xml/secure_store_data_extraction_rules">
    <activity android:name=".MainActivity"/>
  </application>
</manifest>
`
      );

      await compileModsAsync(
        {
          ...exp,
          mods: {
            android: {
              manifest: exp.mods.android.manifest,
              dangerous: exp.mods.android.dangerous,
            },
          },
        },
        {
          projectRoot: tmpDir,
          platforms: ['android'],
        }
      );

      const backupConflictWarnings = warnMessages.filter((msg) =>
        msg.toLowerCase().includes('backup')
      );
      expect(backupConflictWarnings).toEqual([]);

      const manifestContent = fs.readFileSync(
        path.join(androidAppMainDir, 'AndroidManifest.xml'),
        'utf8'
      );
      const parsedManifest = await XML.parseXMLAsync(manifestContent);
      const applicationNode = parsedManifest.manifest.application[0];

      expect(applicationNode.$['android:allowBackup']).toBe('false');
      expect(applicationNode.$['android:fullBackupContent']).toBe(
        BACKUP_RULES_RESOURCE
      );
      expect(applicationNode.$['android:dataExtractionRules']).toBe(
        DATA_EXTRACTION_RULES_RESOURCE
      );
      expect(manifestContent).not.toContain('secure_store_backup_rules');
      expect(manifestContent).not.toContain(
        'secure_store_data_extraction_rules'
      );

      // Verify legacy Android <= 11 (API <= 30) full-backup-content rules
      const legacyRulesXml = fs.readFileSync(
        path.join(androidAppMainDir, 'res', 'xml', BACKUP_RULES_FILE_NAME),
        'utf8'
      );
      const parsedLegacyRules = await XML.parseXMLAsync(legacyRulesXml);
      const legacyRoot = parsedLegacyRules['full-backup-content'];
      expect(legacyRoot).toBeTruthy();
      expect(legacyRoot.include).toBeUndefined();
      expect(
        legacyRoot.exclude.map((node) => ({
          domain: node.$.domain,
          path: node.$.path,
        }))
      ).toEqual(BACKUP_DOMAINS.map((domain) => ({ domain, path: '.' })));

      // Verify Android 12+ (API >= 31) cloud-backup & device-transfer data-extraction-rules
      const modernRulesXml = fs.readFileSync(
        path.join(
          androidAppMainDir,
          'res',
          'xml',
          DATA_EXTRACTION_RULES_FILE_NAME
        ),
        'utf8'
      );
      const parsedModernRules = await XML.parseXMLAsync(modernRulesXml);
      const extractionRoot = parsedModernRules['data-extraction-rules'];
      expect(extractionRoot).toBeTruthy();

      const cloudBackup = extractionRoot['cloud-backup'][0];
      expect(cloudBackup.$.disableIfNoEncryptionCapabilities).toBe('true');
      expect(cloudBackup.include).toBeUndefined();
      expect(
        cloudBackup.exclude.map((node) => ({
          domain: node.$.domain,
          path: node.$.path,
        }))
      ).toEqual(BACKUP_DOMAINS.map((domain) => ({ domain, path: '.' })));

      const deviceTransfer = extractionRoot['device-transfer'][0];
      expect(deviceTransfer.include).toBeUndefined();
      expect(
        deviceTransfer.exclude.map((node) => ({
          domain: node.$.domain,
          path: node.$.path,
        }))
      ).toEqual(BACKUP_DOMAINS.map((domain) => ({ domain, path: '.' })));
    } finally {
      console.warn = originalWarn;
    }
  });

  it('overrides permissive manifest backup attributes safely via applyAndroidBackupManifestAttributes', () => {
    const sampleManifest = {
      manifest: {
        $: {},
        application: [
          {
            $: {
              'android:name': '.MainApplication',
              'android:allowBackup': 'true',
              'android:fullBackupContent': '@xml/secure_store_backup_rules',
              'android:dataExtractionRules':
                '@xml/secure_store_data_extraction_rules',
            },
          },
        ],
      },
    };

    const updated = applyAndroidBackupManifestAttributes(sampleManifest);
    const appAttrs = updated.manifest.application[0].$;

    expect(updated.manifest.$['xmlns:android']).toBe(
      'http://schemas.android.com/apk/res/android'
    );
    expect(updated.manifest.$['xmlns:tools']).toBe(
      'http://schemas.android.com/tools'
    );
    expect(appAttrs['android:allowBackup']).toBe('false');
    expect(appAttrs['android:fullBackupContent']).toBe(BACKUP_RULES_RESOURCE);
    expect(appAttrs['android:dataExtractionRules']).toBe(
      DATA_EXTRACTION_RULES_RESOURCE
    );
  });
});
