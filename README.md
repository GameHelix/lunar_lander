# notifier

Delivers Candylario agents' messages to Telegram through one bot, [@CandylarioBot](https://t.me/CandylarioBot), and passes the commands people send it to the engine. It talks to the engine only through the [engine API](https://github.com/candylario/trader/blob/main/api/openapi.yaml).

- **Messages:** the engine words each message and records it as a `notice` event. The notifier reads each agent's events and delivers its notices to every chat connected to that tenant, starting from the moment the chat connected. Messages go out in order, within Telegram's rate limits, retried until delivered and never sent twice.
- **Commands:** /status, /decide, /stop and /resume go to the engine API; /sellall asks for /confirm first. Only private chats connected with a one-time link are answered, and a command sent while the notifier was down is ignored, except /stop. With several agents, messages carry the agent's name and commands take it (`/stop btc-eth`).
- **Data:** its own Postgres database: which chat follows which tenant, the link codes (hashed), and how far each chat has read.

## Run

```sh
cp .env.example .env       # TELEGRAM_BOT_TOKEN from BotFather; ENGINE_NOTIFIER_TOKEN as in the engine (its token for the notifier); NOTIFIER_API_TOKEN (openssl rand -hex 32); POSTGRES_PASSWORD
docker compose up -d --build                                  # needs the shared network: docker network create candylario
docker compose run --rm notifier link --tenant TENANT_ID      # a one-time link that connects a Telegram chat
```

The app connects chats through the notifier's API on `127.0.0.1:8081` (`notifier:8080` on the shared network) with `Authorization: Bearer $NOTIFIER_API_TOKEN`: `POST /v1/tenants/ID/links` gives a one-time link, `GET /v1/tenants/ID/chats` lists the chats connected and `DELETE /v1/tenants/ID/chats/CHAT` disconnects one. The contract is [api/openapi.yaml](api/openapi.yaml).

On a server prepared by [candylario/infra](https://github.com/candylario/infra): `./deploy.sh deploy@SERVER_IP`; `./move.sh deploy@SERVER_IP` moves a notifier running here, links included, and stops it here.

Tests need Postgres: `TEST_DATABASE_URL=postgres://... go test ./...`
