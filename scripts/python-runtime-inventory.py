"""Inventory installed desktop Python inputs and bundled license notices; never import app data."""
from __future__ import annotations

import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import platform
import re
import sys
import sysconfig
import subprocess
import tomllib
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def runtime_inventory(root: Path) -> dict:
    project = tomllib.loads((root / 'pyproject.toml').read_text(encoding='utf-8'))
    lock = tomllib.loads((root / 'uv.lock').read_text(encoding='utf-8'))
    locked = {(canonicalize_name(item['name']), item['version']) for item in lock['package']}
    components, edges, notices, unresolved = {}, {}, [], []

    def visit(name: str, *, trace: bool = True) -> str:
        distribution = metadata.distribution(name)
        actual = canonicalize_name(distribution.metadata['Name'])
        version = distribution.version
        if (actual, version) not in locked:
            raise ValueError(f'Installed Python distribution differs from uv.lock: {actual}')
        reference = f'pkg:pypi/{actual}@{version}'
        if reference in components:
            return reference
        license_name = distribution.metadata.get('License-Expression') or distribution.metadata.get('License')
        item = {'type': 'library', 'bom-ref': reference, 'name': actual, 'version': version, 'purl': reference}
        if license_name:
            item['licenses'] = [{'license': {'name': license_name}}]
        else:
            unresolved.append({'component': reference, 'reason': 'Installed distribution does not declare a license'})
        components[reference] = item
        for entry in sorted(distribution.files or [], key=str):
            if not re.match(r'(?i)^(licen[sc]es?|copying|notices?|thirdpartynotices)([._-].*)?$', entry.name):
                continue
            file = distribution.locate_file(entry)
            if not file.is_file():
                raise ValueError(f'Installed license file is missing: {actual}/{entry.name}')
            data = file.read_bytes()
            if len(data) > 32 * 1024 * 1024:
                raise ValueError(f'License file exceeds inventory limit: {actual}')
            notices.append({'component': reference, 'file': str(entry), 'sha256': hashlib.sha256(data).hexdigest(), 'text': data.decode('utf-8', errors='replace')})
        children = []
        if trace:
            for expression in distribution.requires or []:
                requirement = Requirement(expression)
                if requirement.marker and not requirement.marker.evaluate({'extra': ''}):
                    continue
                installed = metadata.version(requirement.name)
                if requirement.specifier and installed not in requirement.specifier:
                    raise ValueError(f'Installed Python dependency does not satisfy {actual} -> {requirement.name}')
                children.append(visit(requirement.name))
        edges[reference] = {'ref': reference, 'dependsOn': sorted(set(children))}
        return reference

    roots = []
    for expression in project['project']['dependencies']:
        requirement = Requirement(expression)
        if requirement.marker and not requirement.marker.evaluate({'extra': ''}):
            continue
        installed = metadata.version(requirement.name)
        if requirement.specifier and installed not in requirement.specifier:
            raise ValueError(f'Python runtime dependency does not satisfy pyproject.toml: {requirement.name}')
        roots.append(visit(requirement.name))
    # The PyInstaller bootloader ships in the executable, but its build-only dependencies do not.
    bootloader = visit('pyinstaller', trace=False)
    components[bootloader]['properties'] = [{'name': 'lumatile:python:role', 'value': 'bundled bootloader and frozen importer; build dependencies excluded'}]
    roots.append(bootloader)
    python_ref = f'pkg:generic/cpython@{platform.python_version()}'
    components[python_ref] = {'type': 'platform', 'bom-ref': python_ref, 'name': 'CPython', 'version': platform.python_version(), 'purl': python_ref, 'licenses': [{'license': {'name': 'Python Software Foundation License'}}]}
    python_license = next((path for path in [Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt', Path(sys.base_prefix) / 'LICENSE.txt'] if path.is_file()), Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt')
    if python_license.is_file():
        data = python_license.read_bytes()
        notices.append({'component': python_ref, 'file': 'CPython/LICENSE.txt', 'sha256': hashlib.sha256(data).hexdigest(), 'text': data.decode('utf-8')})
    else:
        unresolved.append({'component': python_ref, 'reason': 'Installed CPython license text is missing'})
    edges[python_ref] = {'ref': python_ref, 'dependsOn': []}
    roots.append(python_ref)
    driver = metadata.distribution('playwright').locate_file('playwright/driver')
    driver_node = driver / ('node.exe' if sys.platform == 'win32' else 'node')
    versions = json.loads(subprocess.check_output([str(driver_node), '-p', 'JSON.stringify(process.versions)'], text=True, timeout=30))
    node_ref = f'pkg:generic/nodejs@{versions["node"]}'
    components[node_ref] = {'type': 'platform', 'bom-ref': node_ref, 'name': 'Node.js (Playwright driver)', 'version': versions['node'], 'purl': node_ref, 'licenses': [{'license': {'name': 'Node.js and bundled third-party licenses'}}], 'properties': [{'name': f'lumatile:nodejs:runtime:{key}', 'value': value} for key, value in sorted(versions.items())]}
    edges[node_ref] = {'ref': node_ref, 'dependsOn': []}
    playwright_ref = f'pkg:pypi/playwright@{metadata.version("playwright")}'
    edges[playwright_ref]['dependsOn'].append(node_ref)
    for notice in notices:
        if notice['file'] == 'playwright/driver/LICENSE':
            notice['component'] = node_ref
    return {'opaqueComponents': [node_ref, python_ref], 'components': sorted(components.values(), key=lambda item: item['bom-ref']), 'dependencies': sorted(edges.values(), key=lambda item: item['ref']), 'roots': sorted(roots), 'notices': notices, 'unresolvedLicenses': unresolved}


if __name__ == '__main__':
    print(json.dumps(runtime_inventory(Path(__file__).resolve().parent.parent), ensure_ascii=False))
