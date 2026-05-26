# WealthKeeper AI Gateway

这是 WealthKeeper iOS App 使用的云端 AI Gateway。iPhone 只访问这个 Gateway，DeepSeek API Key 只放在服务端环境变量中。

## 本地运行

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

在 `.env` 填入：

```bash
WEALTHKEEPER_GATEWAY_TOKEN=自己设置一个长 token
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_DEFAULT_MODEL=deepseek-chat
```

测试健康检查：

```bash
curl http://localhost:8787/health
```

## Render 部署

1. 把代码推到 GitHub。
2. Render 新建 Web Service，并连接 GitHub 仓库。
3. Root Directory 填：

```text
server
```

4. Build Command 填：

```bash
npm install && npm run build
```

5. Start Command 填：

```bash
npm start
```

6. Environment Variables 添加：

```bash
WEALTHKEEPER_GATEWAY_TOKEN=自己设置一个长 token
DEFAULT_PROVIDER=deepseek
DEFAULT_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_DEFAULT_MODEL=deepseek-chat
```

部署成功后测试：

```text
https://你的服务名.onrender.com/health
```

## iPhone App 填写

- 运行方式：真实模型
- 模型服务商：DeepSeek
- Gateway 地址：`https://你的服务名.onrender.com/api/wealthkeeper/chat`
- Gateway Token：Render 环境变量里的 `WEALTHKEEPER_GATEWAY_TOKEN`
- 模型名称：`deepseek-chat`
- 允许发送脱敏财务摘要：开

注意：iPhone 里不要填写 DeepSeek API Key。DeepSeek API Key 只配置在 Render 环境变量中。

## 常见错误

- `401`：Gateway Token 错误。
- `MISSING_API_KEY`：Render 没配置 `DEEPSEEK_API_KEY`。
- `MODEL_ERROR`：DeepSeek 调用失败、模型名错误，或上游服务暂不可用。
- `/health` 可访问但 chat 失败：检查 Gateway Token、DeepSeek API Key、模型名称。

## 扩展 Provider

后续要接入其他模型服务商时，在 `src/services` 增加对应 service，并在 `aiRouterService.ts` 中扩展 provider 分发即可。iOS 端仍只请求统一的 `/api/wealthkeeper/chat`。
