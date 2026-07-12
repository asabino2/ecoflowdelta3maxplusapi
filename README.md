# EcoFlow Local API

Local HTTP API in Node.js for integration with EcoFlow Cloud (signed API) specifically created for the Delta 3 Max Plus model, focusing on:

- Account device listing
- Telemetry queries by serial number (SN)
- AC1/AC2 power control by command
- Swagger documentation at the root endpoint

## Technical Overview

### Stack

- Node.js (native HTTP, no framework)
- HMAC-SHA256 signing for EcoFlow requests
- Swagger UI served at the root endpoint

### Architecture

- Local HTTP listener on `PORT` (default: `18000`)
- Signed proxy to EcoFlow hosts:
  - `api-e.ecoflow.com`
  - `api-a.ecoflow.com`
- Host fallback: tries active host first, then switches when needed

### Authentication

The local API accepts EcoFlow credentials in 2 ways:

1. Request headers (higher priority)
   - `x-ecoflow-access-key`
   - `x-ecoflow-secret-key`
2. Environment variables (fallback)
   - `ECOFLOW_ACCESS_KEY`
   - `ECOFLOW_SECRET_KEY`

## Endpoints

### Documentation

- `GET /`
  - Shows Swagger UI
- `GET /openapi.json`
  - Returns OpenAPI 3.0.3

### Devices

- `GET /api/devices`
  - Lists account devices
  - Returns, when available, `sn`, `deviceName`, `productName`, `online`

### Telemetry by SN

- `GET /api/{SN}/getdata`
  - Returns summarized data, including:
    - `powGetAcIn`
    - `batteryperc`
    - `poweroutsum`
    - `poweroutAc1`
    - `poweroutAc2`
    - `powInSumW`
    - `energyBackupEn`
    - `cmsMaxChgSoc`
    - `cmsMinDsgSoc`
    - `powGetTypec3`
    - `powGetTypec1`
    - `powGetTypec2`
    - `cmsDsgRemTime`
    - `cmsDsgRemTimeFmt` (`HH:MM:SS` format)
    - `cmsChgDsgState` (`0` idle, `1` discharging, `2` charging)
    - `cmsChgDsgStateDesc` (`Idle`, `discharging`, `charging`)

- `GET /api/{SN}/getrawdata`
  - Returns raw payload from EcoFlow

### Power Control

- `POST /api/{SN}/power/ac1`
  - Turns AC1 on/off
  - Optional body:
    ```json
    {
      "state": true
    }
    ```
  - Also accepts `on` as an alias (`true`/`false`)

- `POST /api/{SN}/power/ac2`
  - Turns AC2 on/off
  - Optional body:
    ```json
    {
      "state": false
    }
    ```

## Technical Payload Sent to EcoFlow

### AC1

```json
{
  "sn": "SERIAL_NUMBER",
  "cmdId": 17,
  "cmdFunc": 254,
  "dest": 2,
  "dirDest": 1,
  "dirSrc": 1,
  "needAck": true,
  "params": {
    "cfgAcOutOpen": true
  }
}
```

### AC2

```json
{
  "sn": "SERIAL_NUMBER",
  "cmdId": 17,
  "cmdFunc": 254,
  "dest": 2,
  "dirDest": 1,
  "dirSrc": 1,
  "needAck": true,
  "params": {
    "cfgAc2OutOpen": false
  }
}
```

## Requirements

- Node.js 18+ (Node.js 22 recommended)
- EcoFlow account with valid Access Key and Secret Key

## Local Installation and Run

1. Set environment variables (PowerShell):

```powershell
$env:PORT="18000"
$env:ECOFLOW_ACCESS_KEY="YOUR_ACCESS_KEY"
$env:ECOFLOW_SECRET_KEY="YOUR_SECRET_KEY"
```

2. Run the API:

```powershell
node ecoflowapi.js
```

3. Open the documentation:

- http://localhost:18000/

## Docker Run

### Build image

```powershell
docker build -t ecoflow-local-api .
```

### Run with docker

```powershell
docker run --rm -p 18000:18000 \
  -e PORT=18000 \
  -e ECOFLOW_ACCESS_KEY=YOUR_ACCESS_KEY \
  -e ECOFLOW_SECRET_KEY=YOUR_SECRET_KEY \
  ecoflow-local-api
```

### Run with docker compose

```powershell
docker compose up --build -d
```

## API Call Examples

> Replace `SERIAL_NUMBER` with your device SN.

### 1) List devices (environment credentials)

```bash
curl http://localhost:18000/api/devices
```

### 2) List devices (header credentials)

```bash
curl http://localhost:18000/api/devices \
  -H "x-ecoflow-access-key: YOUR_ACCESS_KEY" \
  -H "x-ecoflow-secret-key: YOUR_SECRET_KEY"
```

### 3) GetData by SN

```bash
curl http://localhost:18000/api/SERIAL_NUMBER/getdata
```

### 4) GetData by SN with headers

```bash
curl http://localhost:18000/api/SERIAL_NUMBER/getdata \
  -H "x-ecoflow-access-key: YOUR_ACCESS_KEY" \
  -H "x-ecoflow-secret-key: YOUR_SECRET_KEY"
```

### 5) GetRawData by SN

```bash
curl http://localhost:18000/api/SERIAL_NUMBER/getrawdata
```

### 6) Turn AC1 on

```bash
curl -X POST http://localhost:18000/api/SERIAL_NUMBER/power/ac1 \
  -H "Content-Type: application/json" \
  -d '{"state":true}'
```

### 7) Turn AC2 off

```bash
curl -X POST http://localhost:18000/api/SERIAL_NUMBER/power/ac2 \
  -H "Content-Type: application/json" \
  -d '{"state":false}'
```

## Common Errors

- `500`: internal error (invalid JSON body, network error, etc.)
- `502`: EcoFlow command request failed
- `404`: endpoint not found

## Security

- Do not commit real keys to the repository
- Prefer environment variables in production
- If using headers, use a secure network and HTTPS in your reverse proxy

## License

Internal/private project usage. Adjust as needed.
