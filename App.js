import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const getDefaultBaseUrl = () => {
  const hostUri =
    Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) {
      return `http://${host}:3001`;
    }
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3001';
  }

  return 'http://localhost:3001';
};

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || getDefaultBaseUrl();
const MAX_CONTEXT_MESSAGES = 20;
const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'model',
  content: 'Hi! Ask me anything and I will reply with Gemini.',
};

const createChat = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: 'New chat',
  messages: [WELCOME_MESSAGE],
});

const getChatTitleFromMessages = (messages) => {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage || !firstUserMessage.content) {
    return 'New chat';
  }

  const title = String(firstUserMessage.content).trim();
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
};

export default function App() {
  const insets = useSafeAreaInsets();
  const initialChat = useMemo(() => createChat(), []);
  const [chats, setChats] = useState([initialChat]);
  const [activeChatId, setActiveChatId] = useState(initialChat.id);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [androidKeyboardOffset, setAndroidKeyboardOffset] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardHeight = event?.endCoordinates?.height || 0;
      setAndroidKeyboardOffset(Math.max(0, keyboardHeight + 8));
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardOffset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) || chats[0],
    [activeChatId, chats]
  );

  const messages = activeChat?.messages || [WELCOME_MESSAGE];

  const updateActiveChat = (updater) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== activeChatId) {
          return chat;
        }
        return updater(chat);
      })
    );
  };

  const openNewChat = () => {
    const newChat = createChat();
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setInput('');
    setIsSidebarOpen(false);
  };

  const openChat = (chatId) => {
    setActiveChatId(chatId);
    setInput('');
    setIsSidebarOpen(false);
  };

  const deleteChat = (chatId) => {
    setChats((prev) => {
      if (prev.length <= 1) {
        const replacementChat = createChat();
        setActiveChatId(replacementChat.id);
        return [replacementChat];
      }

      const remainingChats = prev.filter((chat) => chat.id !== chatId);
      if (chatId === activeChatId && remainingChats.length > 0) {
        setActiveChatId(remainingChats[0].id);
      }
      return remainingChats;
    });
    setInput('');
  };

  const listFooter = useMemo(() => {
    if (!isTyping) {
      return <View style={styles.listFooterSpacing} />;
    }

    return (
      <View style={[styles.messageRow, styles.messageRowLeft]}>
        <View style={[styles.bubble, styles.modelBubble]}>
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color="#4b5563" />
            <Text style={styles.typingText}>Gemini is typing...</Text>
          </View>
        </View>
      </View>
    );
  }, [isTyping]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !activeChat) {
      return;
    }

    const userMessage = {
      id: String(Date.now()),
      role: 'user',
      content: trimmed,
    };

    const nextMessages = [...activeChat.messages, userMessage];

    setInput('');
    updateActiveChat((chat) => ({
      ...chat,
      messages: nextMessages,
      title: getChatTitleFromMessages(nextMessages),
    }));
    setIsSending(true);
    setIsTyping(true);

    try {
      const recentMessages = nextMessages
        .filter((message) => message.role === 'user' || message.role === 'model')
        .slice(-MAX_CONTEXT_MESSAGES);

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: recentMessages }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Request failed');
      }

      const data = await response.json();
      const replyText = String(data.text || '').trim();

      if (replyText.length > 0) {
        updateActiveChat((chat) => ({
          ...chat,
          messages: [
            ...chat.messages,
            {
              id: `${Date.now()}-model`,
              role: 'model',
              content: replyText,
            },
          ],
        }));
      }
    } catch (error) {
      updateActiveChat((chat) => ({
        ...chat,
        messages: [
          ...chat.messages,
          {
            id: `${Date.now()}-error`,
            role: 'system',
            content:
              error instanceof Error
                ? error.message
                : 'Something went wrong. Please try again.',
          },
        ],
      }));
    } finally {
      setIsTyping(false);
      setIsSending(false);
    }
  };

  const renderItem = ({ item }) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    return (
      <View
        style={[
          styles.messageRow,
          isUser ? styles.messageRowRight : styles.messageRowLeft,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.modelBubble,
            isSystem && styles.systemBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isUser ? styles.userText : styles.modelText,
              isSystem && styles.systemText,
            ]}
          >
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  return (
      <View style={styles.container}>
        <Modal
          transparent
          visible={isSidebarOpen}
          animationType="fade"
          onRequestClose={() => setIsSidebarOpen(false)}
        >
          <View style={styles.sidebarOverlay}>
            <Pressable
              style={styles.sidebarBackdrop}
              onPress={() => setIsSidebarOpen(false)}
            />
            <View style={[styles.sidebar, { paddingTop: Math.max(16, insets.top) }]}>
              <Pressable style={styles.newChatButton} onPress={openNewChat}>
                <Text style={styles.newChatButtonText}>+ New Chat</Text>
              </Pressable>
              <FlatList
                data={chats}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const isActive = item.id === activeChatId;
                  return (
                    <View style={[styles.chatItemRow, isActive && styles.chatItemActive]}>
                      <Pressable style={styles.chatItem} onPress={() => openChat(item.id)}>
                        <Text
                          numberOfLines={1}
                          style={[styles.chatItemText, isActive && styles.chatItemTextActive]}
                        >
                          {item.title}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.deleteChatButton}
                        onPress={() => deleteChat(item.id)}
                      >
                        <Text style={styles.deleteChatButtonText}>Delete</Text>
                      </Pressable>
                    </View>
                  );
                }}
              />
            </View>
          </View>
        </Modal>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <View style={styles.header}>
            <Pressable
              style={styles.menuButton}
              onPress={() => setIsSidebarOpen(true)}
            >
              <Text style={styles.menuButtonText}>☰</Text>
            </Pressable>
            <Text style={styles.title}>Gemini Chat</Text>
            <Text style={styles.subtitle}>Connected via your secure proxy</Text>
          </View>
          <FlatList
            ref={listRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            ListFooterComponent={listFooter}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoidingContainer}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
          >
            <View
              style={[
                styles.composer,
                {
                  paddingBottom:
                    Platform.OS === 'ios'
                      ? Math.max(10, insets.bottom + 6)
                      : androidKeyboardOffset > 0
                        ? 10
                        : Math.max(10, insets.bottom + 6),
                  marginBottom: Platform.OS === 'android' ? androidKeyboardOffset : 0,
                },
              ]}
            >
              <TextInput
                style={styles.input}
                placeholder="Type your message"
                value={input}
                onChangeText={setInput}
                editable={!isSending}
                multiline
              />
              <Pressable
                style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={isSending}
              >
                <Text style={styles.sendButtonText}>
                  {isSending ? '...' : 'Send'}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f1ec',
  },
  content: {
    flex: 1,
  },
  keyboardAvoidingContainer: {
    width: '100%',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 12,
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  menuButtonText: {
    fontSize: 18,
    color: '#111827',
    lineHeight: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  listFooterSpacing: {
    height: 8,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  modelBubble: {
    backgroundColor: '#ffffff',
  },
  userBubble: {
    backgroundColor: '#111827',
  },
  systemBubble: {
    backgroundColor: '#fee2e2',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  modelText: {
    color: '#111827',
  },
  userText: {
    color: '#f9fafb',
  },
  systemText: {
    color: '#991b1b',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typingText: {
    marginLeft: 8,
    color: '#4b5563',
    fontSize: 13,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
    backgroundColor: '#f9fafb',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    fontSize: 15,
  },
  sendButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  sidebarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    flexDirection: 'row',
  },
  sidebarBackdrop: {
    flex: 1,
  },
  sidebar: {
    width: 260,
    backgroundColor: '#ffffff',
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  newChatButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  newChatButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  chatItem: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  chatItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    marginBottom: 6,
  },
  chatItemActive: {
    backgroundColor: '#e5e7eb',
  },
  chatItemText: {
    fontSize: 14,
    color: '#374151',
  },
  chatItemTextActive: {
    color: '#111827',
    fontWeight: '600',
  },
  deleteChatButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 6,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  deleteChatButtonText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '600',
  },
});
