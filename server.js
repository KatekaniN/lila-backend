// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai'; // Import OpenAI instead of Google Generative AI
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
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure to update your .env file with this key
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// System context for Lila
const systemContext = process.env.LILA_PERSONALITY;

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

// Generate AI response using OpenAI
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

    // Convert history format from Gemini to OpenAI format
    const messages = [
      { role: "system", content: systemContext }
    ];

    // Add conversation history if it exists
    if (history && history.length > 0) {
      history.forEach(msg => {
        // Convert from Gemini format to OpenAI format
        const role = msg.role === "model" ? "assistant" : msg.role;
        const content = msg.parts[0].text;
        messages.push({ role, content });
      });
    }

    // Add the current user message
    messages.push({ role: "user", content: message });

    // Generate AI response using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.9,
      max_tokens: 1024,
      top_p: 0.95,
    });

    const responseText = completion.choices[0].message.content;

    res.json({ response: responseText });
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({
      error: 'Failed to generate response',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});