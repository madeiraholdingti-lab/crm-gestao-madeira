"""Dispara manualmente o aviso do Maikon pra teste — pega da edge function,
formata igual o workflow n8n faria, envia via Evolution.

Uso: python3 scripts/test_aviso_maikon.py [raul|maikon|ambos]
"""
import json, os, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

DEST = sys.argv[1] if len(sys.argv) > 1 else "raul"
RECIPIENTS = {
    "raul": "5554984351512",
    "maikon": "5547992153480",
}

EVO_URL = "https://sdsd-evolution-api.r65ocn.easypanel.host"
INSTANCE = "isadoraVolek"
API_KEY = os.environ.get("EVO_KEY")
if not API_KEY:
    print("ERRO: defina EVO_KEY no env antes de rodar")
    sys.exit(1)

# 1. Chama edge function
req = urllib.request.Request(
    "https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/taskflow-lembrar-maikon",
    headers={"x-api-key": "maikon-taskflow-2026-secure"},
)
with urllib.request.urlopen(req) as r:
    data = json.loads(r.read().decode())

total = data["total"]
tarefas = data["tarefas"]
dataStr = data["data"]

# 2. Formata igual o Code node do n8n faz
if total == 0:
    msg = f"Bom dia, Dr. Maikon! ☀️\n\nNão há tarefas com prazo para hoje na coluna Lembrar Dr. Maikon."
else:
    lista = "\n".join(f"{i+1}. {t['titulo']}" for i, t in enumerate(tarefas))
    msg = (
        f"🧪 *TESTE MANUAL* 🧪\n\n"
        f"Bom dia, Dr. Maikon, Tudo bem? 😊\n"
        f"Hoje você tem *{total} tarefa{'s' if total != 1 else ''}* para lembrar:\n\n"
        f"📋 *Lembretes de hoje ({dataStr}):*\n{lista}"
    )

print(f"=== Mensagem que será enviada ({len(msg)} chars) ===\n")
print(msg)
print("\n\n=== Disparando ===\n")

# 3. Envia via Evolution
targets = [RECIPIENTS[DEST]] if DEST in ("raul", "maikon") else list(RECIPIENTS.values())
for num in targets:
    body = json.dumps({"number": num, "text": msg}).encode()
    req = urllib.request.Request(
        f"{EVO_URL}/message/sendText/{INSTANCE}",
        data=body,
        headers={"Content-Type": "application/json", "apikey": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read().decode())
            print(f"  → {num}: OK (id {resp.get('key',{}).get('id','?')})")
    except Exception as e:
        body = getattr(e, "read", lambda: b"")().decode() if hasattr(e, "read") else ""
        print(f"  → {num}: ERRO — {e} — {body[:200]}")
