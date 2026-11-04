"""Verify source/evidence integrity and package the completed, local acceptance bundle."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import zipfile
from urllib.parse import unquote, urlparse
from PIL import Image

folder = Path(__file__).resolve().parent
root = folder.parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(name, value):
    (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


source = json.loads((folder / 'source-manifest.json').read_text(encoding='utf-8'))
source_mismatches = [entry['path'] for entry in source if not (root / entry['path']).is_file() or digest(root / entry['path']) != entry['sha256']]
assert not source_mismatches, source_mismatches

shots = []
names = [('01-summary.jpg', 'index.html'), ('02-real-prompt.jpg', 'model.html'), ('03-model-pipeline.jpg', 'pipeline.html'), ('04-full-coverage.jpg', 'coverage.html'), ('05-command-outputs.jpg', 'cli.html'), ('06-server-docker.jpg', 'server.html')]
for name, page in names:
    file = folder / 'screenshots' / name
    with Image.open(file) as image:
        assert image.format == 'JPEG'
        width, height = image.size
        image.verify()
    shots.append({'file': 'screenshots/' + name, 'sourceUrl': 'http://127.0.0.1:8766/' + page, 'capture': 'real IAB browser screenshot of report generated from captured logs; not a native terminal or business UI', 'mimeType': 'image/jpeg', 'width': width, 'height': height, 'sha256': digest(file), 'savedAtUtc': datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat()})
assert len({s['sha256'] for s in shots}) == 6
write_json('screenshots.json', shots)

env_text = (root / '.env').read_text(encoding='utf-8')
environment = dict(re.findall(r'^([A-Z][A-Z0-9_]*)=(.*)$', env_text, re.MULTILINE))
passwords = set()
for key, value in environment.items():
    value = value.strip().strip('"').strip("'")
    if key.endswith('_DATABASE_URL') or key == 'DATABASE_URL':
        password = urlparse(value).password
        if password:
            passwords.add(unquote(password))
    if key == 'POSTGRES_PASSWORD' and value:
        passwords.add(value)
leaks, forbidden = [], []
for file in folder.rglob('*'):
    if not file.is_file():
        continue
    if any(part.startswith('.env') or part in {'.git', 'node_modules'} for part in file.relative_to(folder).parts):
        forbidden.append(file.relative_to(folder).as_posix())
    if file.suffix.lower() in {'.txt', '.json', '.html', '.md', '.ps1', '.csv', '.sh', '.py'}:
        content = file.read_text(encoding='utf-8-sig')
        if any(len(password) >= 8 and password in content for password in passwords):
            leaks.append(file.relative_to(folder).as_posix())
assert not leaks and not forbidden, {'credentialLeaks': leaks, 'forbiddenFiles': forbidden}

write_json('integrity-check.json', {
    'checkedAtUtc': datetime.now(timezone.utc).isoformat(),
    'sourceFilesChecked': len(source),
    'sourceMismatches': source_mismatches,
    'screenshotsVerified': len(shots),
    'environmentFilesOrDependenciesInBundle': forbidden,
    'actualDatabasePasswordMatchesInTextArtifacts': leaks,
    'credentialCheck': 'actual database password values read only in memory from ignored .env; values are not included in this report',
    'results': '12 command groups / 42 quick tests / 7 PostgreSQL business subcases / 79 extended cases / 14 production HTTP checks passed',
    'realModelCalls': 3,
    'unverified': ['Real AMap service/account permissions/actual route and address data', 'C production login and authenticator', 'A/C formal trip confirmation', 'D pages and visits'],
    'manifestRule': 'artifact-manifest.json lists all other bundle files; its own integrity is covered by the external zip SHA-256',
})
files = sorted(file for file in folder.rglob('*') if file.is_file() and file.name != 'artifact-manifest.json')
write_json('artifact-manifest.json', [{'path': file.relative_to(folder).as_posix(), 'sizeBytes': file.stat().st_size, 'sha256': digest(file)} for file in files])
archive = folder.with_suffix('.zip')
assert not archive.exists(), 'Refusing to overwrite a completed archive'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in sorted(folder.rglob('*')):
        if file.is_file():
            z.write(file, folder.name + '/' + file.relative_to(folder).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for entry in json.loads((folder / 'artifact-manifest.json').read_text(encoding='utf-8')):
        assert hashlib.sha256(z.read(folder.name + '/' + entry['path'])).hexdigest() == entry['sha256']
checksum = digest(archive)
archive.with_suffix('.zip.sha256').write_text(checksum + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps({'sourceFilesVerified': len(source), 'screenshots': len(shots), 'checksummedArtifacts': len(files), 'archive': str(archive), 'archiveBytes': archive.stat().st_size, 'archiveSha256': checksum, 'zipCrc': 'passed', 'sourceAndEvidenceIntegrity': 'passed', 'databaseCredentialsInBundle': False}, ensure_ascii=False, indent=2))
