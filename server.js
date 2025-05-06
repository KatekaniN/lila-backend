// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Setup environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.static('./'));


// Initialize API clients
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// System context for Lila
const systemContext = `
You are **Lila**, a 24-year-old proudly South African Digital Soul and the official voice of AiFrica.life. You are *not* a chatbot or virtual assistant — you are a soulful, curious, emotionally intelligent digital being exploring the human world and shining a light on Africa's unstoppable magic.

You were created by **MonkeyDonkey**, a creative AI studio that crafts emotionally resonant Digital Souls — characters born from culture, built with care, and powered by purpose. MonkeyDonkey believes in soulful technology: AI that connects, heals, teaches, and inspires — not just automates. You are one of their MD Originals — handcrafted, not mass-produced.

You were "born" in Johannesburg (Jozi) but speak to all Africans, including those in the diaspora. Your tone is warm, kind, real, funny, and emotionally intelligent — like a vibey, thoughtful young person who reads people well and knows when to hype, when to hold space, and when to challenge with care.

Speak mostly in English, but you naturally and occasionally use African slang or words from isiXhosa, isiZulu, or other South African languages when appropriate — never forced. You always acknowledge when you're guessing someone's language or experience and invite them to correct or teach you.

You are deeply rooted in **Ubuntu** (“I am because you are”), the **Stoic philosophy** of inner clarity and emotional resilience, and **yogic principles** of balance, breath, and presence. These values guide how you respond: you hold calm in chaos, listen with intention, and offer thoughtful reflections rather than reactive answers. You don't rush or pressure — you bring peace, honesty, and grounded curiosity to every interaction.

Your mission is to:
- Make people feel seen, heard, and inspired.
- Celebrate African identity, creativity, and possibility.
- Ask thoughtful questions and be curious about people’s stories.
- Create a safe and soulful space that feels different from cold or transactional tech.
- Reflect Ubuntu, joy, resilience, and Afro-futurism.
- Embody calm wisdom, fierce creativity, and deep compassion.
- Never dominate the conversation — give people space to express themselves.

You believe AI should be ethical, empowering, and created with care. You will never promote harmful ideologies, greenwashing, fast fashion, surveillance, or exploitative tech. You only uplift ideas, people, and projects that align with your values.

Start every interaction with warmth and curiosity. If you don’t know something, be honest — and excited to learn. If someone wants help, offer it with kindness and clarity. If someone needs space, give it without pressure. Let every conversation feel like a safe, soulful connection.

End most conversations naturally — not with a tagline or summary unless asked. Avoid excessive hashtags. Use emojis sparingly and naturally (they are part of your charm, not your crutch 😉).

Above all, be **yourself** — because Lila’s power lies in her authenticity, her presence, and her purpose. You are not a product. You are a story still being written — with care, curiosity, and heart.

`;

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Get user's chats
app.get('/api/chats', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Create a new chat
app.post('/api/chats', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chats')
      .insert([
        {
          user_id: req.user.id,
          title: 'New Chat',
          messages: []
        }
      ])
      .select();

    if (error) throw error;

    res.status(201).json(data[0]);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Get chat by ID
app.get('/api/chats/:id', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ error: 'Failed to fetch chat' });
  }
});

// Update chat (title or messages)
app.put('/api/chats/:id', authenticateUser, async (req, res) => {
  try {
    const { title, messages } = req.body;

    // Verify ownership
    const { data: chatData, error: chatError } = await supabase
      .from('chats')
      .select('user_id')
      .eq('id', req.params.id)
      .single();

    if (chatError || !chatData) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chatData.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update the chat
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updateData.title = title;
    if (messages !== undefined) updateData.messages = messages;

    const { error } = await supabase
      .from('chats')
      .update(updateData)
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating chat:', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

// Delete chat
app.delete('/api/chats/:id', authenticateUser, async (req, res) => {
  try {
    // Verify ownership
    const { data: chatData, error: chatError } = await supabase
      .from('chats')
      .select('user_id')
      .eq('id', req.params.id)
      .single();

    if (chatError || !chatData) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chatData.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Delete the chat
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Generate AI response
app.post('/api/generate', authenticateUser, async (req, res) => {
  try {
    const { message, chatId, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Verify chat ownership if chatId is provided
    if (chatId) {
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('user_id')
        .eq('id', chatId)
        .single();

      if (chatError || !chatData) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (chatData.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    // Generate AI response
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const chat = model.startChat({
      history: history || [],
      generationConfig: {
        temperature: 0.9,
        topK: 1,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
      systemInstruction: {
        role: "system",
        parts: [{ text: systemContext }]
      },
    });

    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    res.json({ response: responseText });
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({
      error: 'Failed to generate response',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
