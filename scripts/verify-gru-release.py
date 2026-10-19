"""Verify signed APK version and every packaged offline web asset against dist."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--version', default='1.2.2')
parser.add_argument('--version-code', type=int, default=5)
args = parser.parse_args()
assert re.fullmatch(r'\d+\.\d+\.\d+', args.version) and args.version_code > 0
release = root / 'releases'
sdk = root / '.tools/android-sdk/build-tools/36.0.0'
env = dict(os.environ)
env['JAVA_HOME'] = str(next((root / '.tools/java').glob('jdk-*')))
env['PATH'] = str(Path(env['JAVA_HOME']) / 'bin') + os.pathsep + env['PATH']
apk = release / f'NOEMA-{args.version}-android.apk'
aab = release / f'NOEMA-{args.version}-unsigned.aab'

def command(*args):
    completed = subprocess.run([str(arg) for arg in args], env=env, capture_output=True, text=True, check=True)
    return completed.stdout

def certificate(path):
    output = command(sdk / 'apksigner.bat', 'verify', '--print-certs', path)
    match = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)', output)
    assert match, 'APK certificate was not reported'
    return match.group(1)

signature = certificate(apk)
assert signature == certificate(release / 'NOEMA-1.1.0-android.apk'), 'Update certificate differs from previous release'
badging = command(sdk / 'aapt.exe', 'dump', 'badging', apk)
assert f"versionCode='{args.version_code}'" in badging and f"versionName='{args.version}'" in badging
assert "name='studio.noema.robot'" in badging
dist = root / 'dist'
assets = {str(path.relative_to(dist)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in dist.rglob('*') if path.is_file()}
assert not any(path.endswith(('models.json', 'dataset.json', '.pt')) for path in assets), 'Research weights entered the public bundle'
bundles = []
for path, prefix in [(apk, 'assets/public/'), (aab, 'base/assets/public/')]:
    with zipfile.ZipFile(path) as archive:
        for asset, expected in assets.items():
            assert hashlib.sha256(archive.read(prefix + asset)).hexdigest() == expected, str(path) + ': ' + asset
    bundles.append({'file': str(path.relative_to(root)).replace('\\', '/'), 'bytes': path.stat().st_size,
                    'matchedAssets': len(assets), 'allAssetHashesMatch': True})
sw = (dist / 'sw.js').read_text(encoding='utf-8')
cache = re.search(r'noema-[0-9a-f]{16}', sw).group(0)
result = {'version': args.version, 'versionCode': args.version_code, 'applicationId': 'studio.noema.robot',
          'modelVersion': 'noema-160-96-gru96-64-6-v3', 'parameters': 77926, 'cache': cache,
          'signatureVerified': True, 'updateCertificateMatchesPreviousRelease': True,
          'certificateSHA256': signature, 'researchWeightsPackaged': False, 'bundles': bundles}
(root / f'artifacts/release-verification-{args.version}.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
sums = []
for path in sorted(release.iterdir()):
    if path.suffix in ('.apk', '.aab'):
        sums.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name)
(release / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n', encoding='utf-8')
print(json.dumps(result))
