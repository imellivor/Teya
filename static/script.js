document.addEventListener('DOMContentLoaded', function() {
    console.log('Тейя загружена!');
    
    // ----- ЭЛЕМЕНТЫ -----
    const chatsScreen = document.getElementById('chatsScreen');
    const chatScreen = document.getElementById('chatScreen');
    const chatsList = document.getElementById('chatsList');
    const backToChatsBtn = document.getElementById('backToChatsBtn');
    const chatTitle = document.getElementById('chatTitle');
    const settingsBtn = document.getElementById('settingsBtn');
    const chatContainer = document.getElementById('chatContainer');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const scrollDownBtn = document.getElementById('scrollDownBtn');
    const newChatModal = document.getElementById('newChatModal');
    const closeNewChatModal = document.getElementById('closeNewChatModal');
    const newStoryRequest = document.getElementById('newStoryRequest');
    const createChatBtn = document.getElementById('createChatBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const storyRequestView = document.getElementById('storyRequestView');
    
    // ----- СОСТОЯНИЕ -----
    let currentChatId = null;
    let abortController = null;
    
    // ----- ИНДИКАТОР ПЕЧАТИ -----
    function showTypingIndicator() {
        hideTypingIndicator();
        const indicator = document.createElement('div');
        indicator.className = 'message assistant typing';
        indicator.id = 'typingIndicator';
        indicator.innerHTML = '<div class="message-content">Тейя печатает<span class="dots">...</span></div>';
        chatContainer.appendChild(indicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    function hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }
    
    // ----- ПРОВЕРКА ПОЛОЖЕНИЯ ПРОКРУТКИ -----
    function toggleScrollButton() {
        if (!chatContainer || !scrollDownBtn) return;
        const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50;
        scrollDownBtn.style.display = isAtBottom ? 'none' : 'flex';
    }
    
    // ----- ЗАГРУЗКА СООБЩЕНИЙ -----
    async function loadChatMessages(chatId) {
        const response = await fetch(`/api/chats/${chatId}`);
        const messages = await response.json();
        chatContainer.innerHTML = '';
        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.sender}`;
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.style.whiteSpace = 'pre-line';
            contentDiv.innerHTML = msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            messageDiv.appendChild(contentDiv);
            chatContainer.appendChild(messageDiv);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
        toggleScrollButton();
    }
    
    // ----- ЗАГРУЗКА ЧАТОВ -----
    async function loadChats() {
        const response = await fetch('/api/chats');
        const chats = await response.json();
        renderChatsList(chats);
    }
    
    // ----- ОТОБРАЖЕНИЕ СПИСКА -----
    function renderChatsList(chats) {
        if (!chats || chats.length === 0) {
            chatsList.innerHTML = `<div class="empty-state"><p>🖤 У тебя пока нет миров</p><p class="hint">Нажми + чтобы создать первый</p></div>`;
            return;
        }
        chatsList.innerHTML = '';
        chats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            chatItem.dataset.id = chat.id;
            const date = new Date(chat.lastUpdated);
            const formattedDate = date.toLocaleDateString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            let lastMessage = chat.lastMessage || 'Новый мир';
            if (lastMessage.length > 60) lastMessage = lastMessage.substring(0, 60) + '...';
            chatItem.innerHTML = `
                <div class="chat-item-title">${chat.title}</div>
                <div class="chat-item-preview">${lastMessage}</div>
                <div class="chat-item-footer">
                    <span class="chat-item-date">${formattedDate}</span>
                    <span class="chat-item-messages-count">💬 ${chat.messagesCount || 0}</span>
                </div>
                <button class="delete-chat-btn" data-id="${chat.id}">✕</button>
            `;
            chatItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-chat-btn')) return;
                openChat(chat.id);
            });
            const deleteBtn = chatItem.querySelector('.delete-chat-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteChat(chat.id);
            });
            chatsList.appendChild(chatItem);
        });
    }
    
    // ----- СОЗДАНИЕ НОВОГО ЧАТА -----
    async function createNewChat() {
        const request = newStoryRequest.value.trim();
        if (!request) return alert('Напиши запрос');
        const chatId = Date.now().toString();
        const title = request.substring(0, 20) + '...';
        
        newChatModal.style.display = 'none';
        newStoryRequest.value = '';
        
        currentChatId = chatId;
        chatTitle.textContent = title;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        stopBtn.disabled = false;
        chatsScreen.style.display = 'none';
        chatScreen.style.display = 'flex';
        chatContainer.innerHTML = '';
        
        addMessageToChat('🔮 Запрос на историю: ' + request, 'system');
        
        await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: chatId, title, request })
        });
        
        showTypingIndicator();
        const response = await fetch(`/api/chats/${chatId}/start`);
        const data = await response.json();
        hideTypingIndicator();
        addMessageToChat(data.reply, 'assistant');
    }
    
    // ----- ОТКРЫТЬ ЧАТ -----
    async function openChat(chatId) {
        currentChatId = chatId;
        const chatsResponse = await fetch('/api/chats');
        const chats = await chatsResponse.json();
        const chat = chats.find(c => c.id === chatId);
        if (chat) chatTitle.textContent = chat.title;
        
        messageInput.disabled = false;
        sendBtn.disabled = false;
        stopBtn.disabled = false;
        
        chatsScreen.style.display = 'none';
        chatScreen.style.display = 'flex';
        
        await loadChatMessages(chatId);
    }
    
    // ----- ОТПРАВКА СООБЩЕНИЯ -----
    async function sendMessage() {
        const userText = messageInput.value.trim();
        if (!userText || !currentChatId) return;
        
        // Отменяем предыдущий запрос, если он был
        if (abortController) {
            abortController.abort();
        }
        
        addMessageToChat(userText, 'user');
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        abortController = new AbortController();
        
        showTypingIndicator();
        try {
            const response = await fetch(`/api/chats/${currentChatId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userText }),
                signal: abortController.signal
            });
            
            const data = await response.json();
            hideTypingIndicator();
            addMessageToChat(data.reply, 'assistant');
            abortController = null;
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Запрос отменён');
                hideTypingIndicator();
                addMessageToChat('⏹️ Генерация остановлена', 'system');
            } else {
                console.error('Ошибка:', error);
                hideTypingIndicator();
                addMessageToChat('Ошибка связи с Тейей', 'system');
            }
            abortController = null;
        }
    }
    
    // ----- ОСТАНОВКА ГЕНЕРАЦИИ -----
    function stopGeneration() {
        if (abortController) {
            abortController.abort();
            abortController = null;
        } else {
            addMessageToChat('⏹️ Нет активной генерации', 'system');
        }
    }
    
    // ----- ДОБАВЛЕНИЕ СООБЩЕНИЯ -----
    function addMessageToChat(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.style.whiteSpace = 'pre-line';
        contentDiv.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        toggleScrollButton();
    }
    
    // ----- УДАЛЕНИЕ ЧАТА -----
    async function deleteChat(chatId) {
        if (!confirm('🖤 Точно удалить этот мир?')) return;
        await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
        if (currentChatId === chatId) {
            chatsScreen.style.display = 'flex';
            chatScreen.style.display = 'none';
            currentChatId = null;
        }
        loadChats();
    }
    
    // ----- ОБРАБОТЧИКИ -----
    backToChatsBtn.addEventListener('click', () => {
        chatsScreen.style.display = 'flex';
        chatScreen.style.display = 'none';
        currentChatId = null;
        loadChats();
    });
    
    newChatBtn.addEventListener('click', () => newChatModal.style.display = 'flex');
    closeNewChatModal.addEventListener('click', () => newChatModal.style.display = 'none');
    createChatBtn.addEventListener('click', createNewChat);
    
    settingsBtn.addEventListener('click', async () => {
        if (!currentChatId) return;
        const response = await fetch('/api/chats');
        const chats = await response.json();
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            storyRequestView.value = chat.request;
            settingsModal.style.display = 'flex';
        }
    });
    
    closeSettingsBtn.addEventListener('click', () => settingsModal.style.display = 'none');
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGeneration);
    
    if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', () => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }
    
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    chatContainer.addEventListener('scroll', toggleScrollButton);
    
    window.addEventListener('click', (e) => {
        if (e.target === newChatModal) newChatModal.style.display = 'none';
        if (e.target === settingsModal) settingsModal.style.display = 'none';
    });
    
    // ----- ЗАПУСК -----
    loadChats();
});