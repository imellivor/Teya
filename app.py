from flask import Flask, request, jsonify, render_template
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import requests
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# =====================================
# НАСТРОЙКИ
# =====================================
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DATABASE_URL = os.getenv('DATABASE_URL')

# =====================================
# ПОДКЛЮЧЕНИЕ К POSTGRESQL
# =====================================
def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # Таблица чатов
    c.execute('''CREATE TABLE IF NOT EXISTS chats
                 (id TEXT PRIMARY KEY,
                  title TEXT,
                  request TEXT,
                  last_updated TEXT)''')
    
    # Таблица сообщений
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id SERIAL PRIMARY KEY,
                  chat_id TEXT,
                  sender TEXT,
                  content TEXT,
                  is_dice_result INTEGER DEFAULT 0,
                  timestamp TEXT,
                  FOREIGN KEY (chat_id) REFERENCES chats (id))''')
    
    conn.commit()
    conn.close()

# =====================================
# РАБОТА С БАЗОЙ
# =====================================
def get_chats():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, title, request, last_updated FROM chats ORDER BY last_updated DESC")
    chats = c.fetchall()
    
    result = []
    for chat in chats:
        c.execute("SELECT COUNT(*) FROM messages WHERE chat_id = %s", (chat['id'],))
        msg_count = c.fetchone()['count']
        
        c.execute("SELECT content FROM messages WHERE chat_id = %s ORDER BY timestamp DESC LIMIT 1", (chat['id'],))
        last_msg = c.fetchone()
        
        result.append({
            'id': chat['id'],
            'title': chat['title'],
            'request': chat['request'],
            'lastUpdated': chat['last_updated'],
            'messagesCount': msg_count,
            'lastMessage': last_msg['content'] if last_msg else None
        })
    
    conn.close()
    return result

def get_chat_messages(chat_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT sender, content, is_dice_result, timestamp FROM messages WHERE chat_id = %s ORDER BY timestamp ASC", (chat_id,))
    messages = c.fetchall()
    conn.close()
    
    return [{
        'sender': msg['sender'],
        'content': msg['content'],
        'isDiceResult': bool(msg['is_dice_result']),
        'timestamp': msg['timestamp']
    } for msg in messages]

def create_new_chat(chat_id, title, request_text):
    conn = get_db()
    c = conn.cursor()
    now = datetime.now().isoformat()
    c.execute("INSERT INTO chats (id, title, request, last_updated) VALUES (%s, %s, %s, %s)",
              (chat_id, title, request_text, now))
    conn.commit()
    conn.close()

def save_message(chat_id, sender, content, is_dice_result=False):
    conn = get_db()
    c = conn.cursor()
    now = datetime.now().isoformat()
    c.execute("INSERT INTO messages (chat_id, sender, content, is_dice_result, timestamp) VALUES (%s, %s, %s, %s, %s)",
              (chat_id, sender, content, 1 if is_dice_result else 0, now))
    c.execute("UPDATE chats SET last_updated = %s WHERE id = %s", (now, chat_id))
    conn.commit()
    conn.close()

def delete_chat(chat_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM messages WHERE chat_id = %s", (chat_id,))
    c.execute("DELETE FROM chats WHERE id = %s", (chat_id,))
    conn.commit()
    conn.close()

# =====================================
# ПРОМТ
# =====================================
def load_system_prompt():
    try:
        with open('prompts/system.txt', 'r', encoding='utf-8') as f:
            return f.read()
    except:
        return "Ты — Ведущая. Веди историю."

# =====================================
# ЗАПРОС К DEEPSEEK
# =====================================
def ask_deepseek(chat_id, user_message):
    messages = get_chat_messages(chat_id)
    
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT request FROM chats WHERE id = %s", (chat_id,))
    story_request = c.fetchone()['request']
    conn.close()
    
    base_prompt = load_system_prompt()
    system_prompt = f"""{base_prompt}\n\nЗапрос на эту историю: {story_request}\n\nПиши от третьего лица."""
    
    history = []
    for msg in messages:
        role = "user" if msg['sender'] == 'user' else "assistant"
        history.append({"role": role, "content": msg['content']})
    history.append({"role": "user", "content": user_message})
    
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": system_prompt}, *history],
        "temperature": 1.3,
        "max_tokens": 2000
    }
    
    try:
        response = requests.post(DEEPSEEK_API_URL, headers=headers, json=data)
        response.raise_for_status()
        result = response.json()
        return result['choices'][0]['message']['content']
    except Exception as e:
        print(f"Ошибка DeepSeek: {e}")
        return "Тейя задумалась... Что-то пошло не так."

# =====================================
# МАРШРУТЫ
# =====================================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chats', methods=['GET'])
def api_get_chats():
    return jsonify(get_chats())

@app.route('/api/chats/<chat_id>', methods=['GET'])
def api_get_chat(chat_id):
    return jsonify(get_chat_messages(chat_id))

@app.route('/api/chats', methods=['POST'])
def api_create_chat():
    data = request.json
    chat_id = data.get('id')
    title = data.get('title')
    request_text = data.get('request')
    create_new_chat(chat_id, title, request_text)
    save_message(chat_id, 'system', f'🔮 Запрос на историю: {request_text}')
    return jsonify({'status': 'ok', 'chatId': chat_id})

@app.route('/api/chats/<chat_id>/start', methods=['GET'])
def api_start_chat(chat_id):
    start_scene = ask_deepseek(chat_id, "Начни историю с этого запроса. Опиши первую сцену и предложи 2-4 варианта действий.")
    return jsonify({'reply': start_scene})

@app.route('/api/chats/<chat_id>/messages', methods=['POST'])
def api_send_message(chat_id):
    data = request.json
    user_message = data.get('message')
    save_message(chat_id, 'user', user_message)
    assistant_reply = ask_deepseek(chat_id, user_message)
    save_message(chat_id, 'assistant', assistant_reply)
    return jsonify({'reply': assistant_reply})

@app.route('/api/chats/<chat_id>', methods=['DELETE'])
def api_delete_chat(chat_id):
    delete_chat(chat_id)
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
