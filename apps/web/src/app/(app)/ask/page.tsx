'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  conversationApi,
  type Conversation,
  type ConversationDetail,
  type ConversationMessage,
  type ConversationScope,
} from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';
import { useAuth } from '@/components/auth-provider';
import { ConversationSidebar } from './_components/conversation-sidebar';
import { ChatPanel } from './_components/chat-panel';
import { AskHome } from './_components/ask-home';
import { AskRail } from './_components/ask-rail';
import { ReplayPanel } from './_components/replay-panel';
import { WhatChangedPanel } from './_components/what-changed-panel';
import { GovernancePanel } from './_components/governance-panel';

function tempMessage(role: string, content: string): ConversationMessage {
  return {
    id: `tmp-${crypto.randomUUID()}`,
    role,
    content,
    sources: [],
    authorId: null,
    createdAt: new Date().toISOString(),
  };
}

function AskWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const activeId = params.get('c');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [replayQuery, setReplayQuery] = useState<string | null>(null);
  const [changesQuery, setChangesQuery] = useState<string | null>(null);
  const [governanceProduct, setGovernanceProduct] = useState<string | null>(null);
  const detailReqId = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const res = await conversationApi.list({ search: search || undefined, limit: 100 });
      setConversations(res.items);
    } catch {
      /* leave prior list */
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  // Team conversations can change from other members — keep the list fresh.
  useLiveRefresh(['knowledge.updated'], () => void loadList());

  // Load the active conversation's history.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      setMessages([]);
      return;
    }
    const reqId = ++detailReqId.current;
    void conversationApi
      .get(activeId)
      .then((d) => {
        if (reqId !== detailReqId.current) return;
        setDetail(d);
        setMessages(d.messages);
      })
      .catch(() => {
        if (reqId !== detailReqId.current) return;
        setDetail(null);
        setMessages([]);
      });
  }, [activeId]);

  const select = useCallback((id: string) => router.replace(`/ask?c=${id}`), [router]);

  async function createConversation(scope: ConversationScope) {
    const conversation = await conversationApi.create({ scope });
    await loadList();
    select(conversation.id);
  }

  // Ask from the home view: create a personal chat, send the question, then
  // open the conversation (which loads the persisted Q&A).
  async function startChatWith(question: string) {
    setSending(true);
    try {
      const conversation = await conversationApi.create({ scope: 'personal' });
      await conversationApi.sendMessage(conversation.id, question);
      await loadList();
      select(conversation.id);
    } catch {
      /* stay on home; the user can retry */
    } finally {
      setSending(false);
    }
  }

  async function send(question: string) {
    if (!activeId) return;
    const optimistic = tempMessage('user', question);
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const res = await conversationApi.sendMessage(activeId, question);
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        res.userMessage,
        res.assistantMessage,
      ]);
      void loadList(); // refresh titles + recency ordering
    } catch {
      setMessages((m) => [
        ...m,
        tempMessage('assistant', 'I had trouble reaching your Brain just now. Please try again.'),
      ]);
    } finally {
      setSending(false);
    }
  }

  async function rename(c: Conversation) {
    const title = window.prompt('Rename conversation', c.title);
    if (!title || title.trim() === c.title) return;
    await conversationApi.rename(c.id, title.trim());
    await loadList();
    if (c.id === activeId) setDetail((d) => (d ? { ...d, title: title.trim() } : d));
  }

  async function archive(c: Conversation) {
    await conversationApi.archive(c.id, !c.isArchived);
    await loadList();
  }

  async function remove(c: Conversation) {
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    await conversationApi.remove(c.id);
    if (c.id === activeId) router.replace('/ask');
    await loadList();
  }

  // Replay / What Changed take over the workspace when triggered from "/".
  if (replayQuery !== null) {
    return (
      <div className="h-[calc(100vh-9rem)] min-h-0">
        <ReplayPanel initialQuery={replayQuery} onExit={() => setReplayQuery(null)} />
      </div>
    );
  }
  if (changesQuery !== null) {
    return (
      <div className="h-[calc(100vh-9rem)] min-h-0">
        <WhatChangedPanel initialQuery={changesQuery} onExit={() => setChangesQuery(null)} />
      </div>
    );
  }
  if (governanceProduct !== null) {
    return (
      <div className="h-[calc(100vh-9rem)] min-h-0">
        <GovernancePanel product={governanceProduct} onExit={() => setGovernanceProduct(null)} />
      </div>
    );
  }

  const sidebar = (
    <aside className="hidden min-h-0 border-r pr-6 md:block">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        search={search}
        onSearch={setSearch}
        onNew={(scope) => void createConversation(scope)}
        onSelect={select}
        onRename={(c) => void rename(c)}
        onArchive={(c) => void archive(c)}
        onDelete={(c) => void remove(c)}
      />
    </aside>
  );

  // Home view — greeting, ask box, insights + right rail — when no chat is open.
  if (!activeId) {
    return (
      <div className="grid h-[calc(100vh-9rem)] gap-6 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {sidebar}
        <main className="min-h-0">
          <AskHome
            userName={user?.name ?? null}
            sending={sending}
            onAsk={(q) => void startChatWith(q)}
          />
        </main>
        <aside className="hidden min-h-0 xl:block">
          <AskRail />
        </aside>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-6 md:grid-cols-[300px_1fr]">
      {sidebar}
      <main className="min-h-0">
        <ChatPanel
          conversation={detail}
          messages={messages}
          sending={sending}
          onSend={(q) => void send(q)}
          onReplay={(q) => setReplayQuery(q)}
          onChanges={(q) => setChangesQuery(q)}
          onGovernance={(p) => setGovernanceProduct(p)}
        />
      </main>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <AskWorkspace />
    </Suspense>
  );
}
