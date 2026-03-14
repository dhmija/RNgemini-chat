const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    name: 'chat-app-server',
    status: 'ok',
    endpoints: ['GET /health', 'POST /chat'],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/chat', async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const contents = messages
      .filter(
        (message) =>
          message &&
          message.content &&
          (message.role === 'user' || message.role === 'model')
      )
      .map((message) => ({
        role: message.role,
        parts: [{ text: String(message.content) }],
      }));

    if (contents.length === 0) {
      return res
        .status(400)
        .json({ error: 'messages must include user/model content' });
    }

    const result = await model.generateContent({ contents });
    const text = result.response.text();

    return res.json({ text });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const normalizedMessage = rawMessage.toLowerCase();

    if (
      normalizedMessage.includes('api key expired') ||
      normalizedMessage.includes('api_key_invalid')
    ) {
      return res
        .status(401)
        .json({ error: 'Invalid or expired GEMINI_API_KEY. Please renew it.' });
    }

    if (normalizedMessage.includes('quota')) {
      return res
        .status(429)
        .json({ error: 'Gemini quota exceeded. Please try again later.' });
    }

    return res.status(500).json({ error: 'Unable to reach Gemini right now.' });
  }
});

app.listen(port, () => {
  console.log(`Gemini proxy listening on http://localhost:${port}`);
});
