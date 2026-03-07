# Setup

This prototype uses a local Python virtual environment for the EyeTrax companion bridge.

## Windows

Use Python 3.11 if possible.

```powershell
cd D:\path\to\Hack-Canada\eye-tracking
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
. .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r companion\requirements.txt
cd companion
. ..\.venv\Scripts\Activate.ps1
python -m eyetrax_bridge.server --host 127.0.0.1 --port 8765
```

If `py` is not available, use a direct Python 3.11 path:

```powershell
cd D:\path\to\Hack-Canada\eye-tracking
& "C:\Path\To\Python311\python.exe" -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
. .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r companion\requirements.txt
cd companion
. ..\.venv\Scripts\Activate.ps1
python -m eyetrax_bridge.server --host 127.0.0.1 --port 8765
```

Activate the venv later:

```powershell
cd D:\path\to\Hack-Canada\eye-tracking
. .\.venv\Scripts\Activate.ps1
```

## macOS

Use Python 3.11 if possible.

```bash
cd /path/to/Hack-Canada/eye-tracking
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r companion/requirements.txt
cd companion
source ../.venv/bin/activate
python -m eyetrax_bridge.server --host 127.0.0.1 --port 8765
```

If `python3.11` is not on your PATH but `python3` points to 3.11:

```bash
cd /path/to/Hack-Canada/eye-tracking
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r companion/requirements.txt
cd companion
source ../.venv/bin/activate
python -m eyetrax_bridge.server --host 127.0.0.1 --port 8765
```

Activate the venv later:

```bash
cd /path/to/Hack-Canada/eye-tracking
source .venv/bin/activate
```
