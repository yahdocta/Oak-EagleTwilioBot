# Oak-EagleTwilioBot
Oak &amp; Eagle automated outbound twilio bot.

## Run a CSV campaign quickly

Put CSV files in `campaign-inputs/`, then run:

```bash
./run leads.csv
```

Optional campaign id:

```bash
./run leads.csv test1
```

## Web UI

Start the server:

```bash
npm start
```

The server also starts the configured Cloudflare Tunnel by default, using `~/.cloudflared/config.yml`.

Open the campaign console:

```text
http://SERVER_IP:3000/
```

Use the page to upload a CSV, start a campaign, end a running campaign, monitor activity, and check Cloudflare Tunnel status. If you are accessing it from another computer, make sure the server firewall allows the configured `PORT`.
