"""
Adapta o workflow modelo `🏥 WhatsApp - Pacientes (Dr. Maikon).json` pra:
1. Path do webhook: whatsapp-pacientes → consultorio-pacientes
2. Z-API → Evolution API:
   - URL pra POST /message/sendText/Consultorio
   - Body { phone, message } → { number, text }
   - Header Client-Token → apikey
3. Renomeia o workflow pra deixar claro que é a versão Evolution

Saída: docs/n8n-workflows/whatsapp-consultorio-evolution.json
"""

import json, sys, copy, os
from pathlib import Path

REPO = Path(r'C:\Users\rauls\crm-gestao-madeira')
SRC = REPO / '🏥 WhatsApp - Pacientes (Dr. Maikon).json'
OUT = REPO / 'docs' / 'n8n-workflows' / 'consultorio-pacientes-evolution.json'

EVOLUTION_BASE = 'https://sdsd-evolution-api.r65ocn.easypanel.host'
# Placeholder — substituído antes do import via --evolution-key=... ou env EVOLUTION_API_KEY.
# Valor real fica em config_global.evolution_api_key (Supabase) e nas env do n8n.
EVOLUTION_KEY = os.environ.get('EVOLUTION_API_KEY', '<<EVOLUTION_API_KEY>>')
INSTANCE = 'Consultorio'
WEBHOOK_PATH_NEW = 'consultorio-pacientes'
WEBHOOK_PATH_OLD = 'whatsapp-pacientes'

OUT.parent.mkdir(parents=True, exist_ok=True)
d = json.loads(SRC.read_text(encoding='utf-8'))

stats = {'webhook': 0, 'zapi': 0}

# Renomeia
d['name'] = '🏥 Consultório - Pacientes (Dr. Maikon) [Evolution]'

for n in d.get('nodes', []):
    typ = n.get('type', '')
    name = n.get('name', '')
    params = n.get('parameters', {})

    # 1. Webhook path
    if typ == 'n8n-nodes-base.webhook':
        if params.get('path') == WEBHOOK_PATH_OLD:
            params['path'] = WEBHOOK_PATH_NEW
            stats['webhook'] += 1

    # 2. Z-API → Evolution
    if typ == 'n8n-nodes-base.httpRequest':
        url = params.get('url', '') or ''
        if 'z-api.io' not in url:
            continue

        # URL pra Evolution sendText na instância Consultorio
        params['url'] = f'{EVOLUTION_BASE}/message/sendText/{INSTANCE}'

        # Body — dois padrões no JSON modelo:
        #   (a) bodyParameters com phone/message keypair
        #   (b) jsonBody raw "={{ JSON.stringify({ phone: ..., message: ... }) }}"
        specify = params.get('specifyBody')

        if specify == 'json' or params.get('jsonBody'):
            # Padrão (b): troca phone:/message: dentro do template literal
            jb = params.get('jsonBody', '') or ''
            # Substitui keys de objeto JS — usa regex tolerante a aspas
            import re
            jb = re.sub(r"\bphone\s*:", "number:", jb)
            jb = re.sub(r"\bmessage\s*:", "text:", jb)
            jb = re.sub(r'"phone"\s*:', '"number":', jb)
            jb = re.sub(r'"message"\s*:', '"text":', jb)
            params['jsonBody'] = jb
            params['specifyBody'] = 'json'
        else:
            # Padrão (a): keypair
            old_body = params.get('bodyParameters', {}) or {}
            new_body_params = []
            for p in (old_body.get('parameters') or []):
                n_param = (p.get('name') or '').lower()
                v_param = p.get('value')
                if n_param == 'phone':
                    new_body_params.append({'name': 'number', 'value': v_param})
                elif n_param == 'message':
                    new_body_params.append({'name': 'text', 'value': v_param})
                else:
                    new_body_params.append({'name': p.get('name'), 'value': v_param})
            if new_body_params:
                params['bodyParameters'] = {'parameters': new_body_params}
            params['specifyBody'] = 'keypair'

        # Garante sendBody=true e contentType json
        params['sendBody'] = True
        params['contentType'] = 'json'

        # Headers: troca Client-Token por apikey
        old_hdr = params.get('headerParameters', {}) or {}
        new_hdr_params = []
        had_apikey = False
        for h in (old_hdr.get('parameters') or []):
            hn = (h.get('name') or '').lower()
            if hn == 'client-token':
                new_hdr_params.append({'name': 'apikey', 'value': EVOLUTION_KEY})
                had_apikey = True
            else:
                new_hdr_params.append({'name': h.get('name'), 'value': h.get('value')})
        if not had_apikey:
            new_hdr_params.append({'name': 'apikey', 'value': EVOLUTION_KEY})
        new_hdr_params.append({'name': 'Content-Type', 'value': 'application/json'})

        # Dedup (case-insensitive)
        seen = set()
        deduped = []
        for h in new_hdr_params:
            k = (h.get('name') or '').lower()
            if k in seen: continue
            seen.add(k)
            deduped.append(h)

        params['headerParameters'] = {'parameters': deduped}
        params['sendHeaders'] = True

        stats['zapi'] += 1

# Limpa pinData/versionId pra evitar conflito no import
d.pop('pinData', None)
d.pop('versionId', None)
# n8n CLI exige id. Geramos curto e estável.
d['id'] = 'consultorio-pacientes-evo-v1'
d['active'] = False  # ativar manualmente após import

OUT.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding='utf-8')

print(f'Adaptado: {OUT}')
print(f'Webhook path renomeado: {stats["webhook"]}')
print(f'Nodes Z-API adaptados: {stats["zapi"]}')
print(f'Nome do workflow: {d["name"]}')
