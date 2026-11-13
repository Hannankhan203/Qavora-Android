'use strict';

const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'qavora-android-backup-protection';
const PLUGIN_VERSION = '1.0.0';

const BACKUP_RULES_FILE_NAME = 'qavora_backup_rules.xml';
const DATA_EXTRACTION_RULES_FILE_NAME = 'qavora_data_extraction_rules.xml';

const BACKUP_RULES_RESOURCE = '@xml/qavora_backup_rules';
const DATA_EXTRACTION_RULES_RESOURCE = '@xml/qavora_data_extraction_rules';

const BACKUP_DOMAINS = Object.freeze([
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
]);

const EXCLUDE_RULES_LINES = BACKUP_DOMAINS.map(
  (domain) => `    <exclude domain="${domain}" path="." />`
).join('\n');

const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Android 11 (API 30) and lower Auto Backup rules for Qavora.
  Excludes all application storage domains (SharedPreferences / SecureStore,
  AsyncStorage SQLite databases, internal files, root, and external files).
-->
<full-backup-content>
${BACKUP_DOMAINS.map((domain) => `  <exclude domain="${domain}" path="." />`).join('\n')}
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Android 12 (API 31) and higher data extraction rules for Qavora.
  Excludes all application storage domains from both Google cloud backups
  and device-to-device (D2D) transfers.
-->
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
${EXCLUDE_RULES_LINES}
  </cloud-backup>
  <device-transfer>
${EXCLUDE_RULES_LINES}
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Applies explicit non-backup and data-extraction protection attributes to
 * AndroidManifest.xml's <application> element.
 */
function applyAndroidBackupManifestAttributes(androidManifest) {
  if (!androidManifest || typeof androidManifest !== 'object') {
    return androidManifest;
  }

  if (androidManifest.manifest && typeof androidManifest.manifest === 'object') {
    androidManifest.manifest.$ = {
      ...(androidManifest.manifest.$ || {}),
      'xmlns:android':
        (androidManifest.manifest.$ &&
          androidManifest.manifest.$['xmlns:android']) ||
        'http://schemas.android.com/apk/res/android',
      'xmlns:tools':
        (androidManifest.manifest.$ &&
          androidManifest.manifest.$['xmlns:tools']) ||
        'http://schemas.android.com/tools',
    };
  }

  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  mainApplication.$ = {
    ...(mainApplication.$ || {}),
    'android:allowBackup': 'false',
    'android:fullBackupContent': BACKUP_RULES_RESOURCE,
    'android:dataExtractionRules': DATA_EXTRACTION_RULES_RESOURCE,
  };

  return androidManifest;
}

/**
 * Writes legacy (<full-backup-content>) and modern (<data-extraction-rules>)
 * Android backup exclusion XML files into `android/app/src/main/res/xml`.
 */
async function writeAndroidBackupRuleFiles(platformProjectRoot) {
  const xmlDir = path.join(
    platformProjectRoot,
    'app',
    'src',
    'main',
    'res',
    'xml'
  );
  await fs.promises.mkdir(xmlDir, { recursive: true });

  await Promise.all([
    fs.promises.writeFile(
      path.join(xmlDir, BACKUP_RULES_FILE_NAME),
      BACKUP_RULES_XML,
      'utf8'
    ),
    fs.promises.writeFile(
      path.join(xmlDir, DATA_EXTRACTION_RULES_FILE_NAME),
      DATA_EXTRACTION_RULES_XML,
      'utf8'
    ),
  ]);

  return xmlDir;
}

const withAndroidBackupProtection = (config) => {
  const nextConfig = {
    ...config,
    android: {
      ...(config.android || {}),
      allowBackup: false,
    },
  };

  let updatedConfig = withAndroidManifest(nextConfig, (modConfig) => {
    modConfig.modResults = applyAndroidBackupManifestAttributes(
      modConfig.modResults
    );
    return modConfig;
  });

  updatedConfig = withDangerousMod(updatedConfig, [
    'android',
    async (modConfig) => {
      await writeAndroidBackupRuleFiles(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);

  return updatedConfig;
};

const plugin = createRunOncePlugin(
  withAndroidBackupProtection,
  PLUGIN_NAME,
  PLUGIN_VERSION
);

plugin.PLUGIN_NAME = PLUGIN_NAME;
plugin.PLUGIN_VERSION = PLUGIN_VERSION;
plugin.BACKUP_DOMAINS = BACKUP_DOMAINS;
plugin.BACKUP_RULES_FILE_NAME = BACKUP_RULES_FILE_NAME;
plugin.DATA_EXTRACTION_RULES_FILE_NAME = DATA_EXTRACTION_RULES_FILE_NAME;
plugin.BACKUP_RULES_RESOURCE = BACKUP_RULES_RESOURCE;
plugin.DATA_EXTRACTION_RULES_RESOURCE = DATA_EXTRACTION_RULES_RESOURCE;
plugin.BACKUP_RULES_XML = BACKUP_RULES_XML;
plugin.DATA_EXTRACTION_RULES_XML = DATA_EXTRACTION_RULES_XML;
plugin.applyAndroidBackupManifestAttributes =
  applyAndroidBackupManifestAttributes;
plugin.writeAndroidBackupRuleFiles = writeAndroidBackupRuleFiles;

module.exports = plugin;
