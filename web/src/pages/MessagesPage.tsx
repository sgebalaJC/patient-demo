import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { MessageThreadView } from '../components/messages/MessageThreadView';
import { NewMessageModal } from '../components/messages/NewMessageModal';
import { AdminNewMessageModal } from '../components/messages/AdminNewMessageModal';
import { useAuth } from '../hooks/useAuth';
import { messageThreadOperations } from '../lib/firestore';
import { MessageThread } from '../types';
import { StatusBadge } from '../components/ui/StatusBadge';
import {
    ArrowLeft,
    Plus,
    MessageSquare,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { PaginationBar } from '../components/ui/PaginationBar';
import { SearchInput } from '../components/ui/SearchInput';
import { getPriorityTextColor, getThreadStatusColor } from '../lib/status-helpers';
import { formatRelative } from '../lib/date-helpers';

export const MessagesPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [allThreads, setAllThreads] = useState<MessageThread[]>([]);
    const [selectedThread, setSelectedThread] = useState<MessageThread | null>(null);
    const [loading, setLoading] = useState(true);
    const [showNewMessage, setShowNewMessage] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread' | 'priority'>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 10;
    const pendingThreadId = searchParams.get('thread');

    const isAdmin = userProfile?.role === 'admin';

    // Real-time thread list listener
    useEffect(() => {
        if (!user || !userProfile) return;

        const unsubscribe = isAdmin
            ? messageThreadOperations.onAdminThreads((threads) => {
                setAllThreads(threads);
                setLoading(false);
            })
            : messageThreadOperations.onPatientThreads(user.uid, (threads) => {
                setAllThreads(threads);
                setLoading(false);
            });

        return () => unsubscribe();
    }, [user, userProfile]);

    // Auto-select thread from URL param (deep link from dashboard/notification)
    useEffect(() => {
        if (pendingThreadId && allThreads.length > 0) {
            const thread = allThreads.find(t => t.id === pendingThreadId);
            if (thread) {
                setSelectedThread(thread);
            }
            setSearchParams({}, { replace: true });
        }
    }, [pendingThreadId, allThreads]);

    // Keep selected thread in sync with real-time updates
    useEffect(() => {
        if (selectedThread) {
            const updated = allThreads.find(t => t.id === selectedThread.id);
            if (updated) setSelectedThread(updated);
        }
    }, [allThreads]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [filter]);

    // Client-side filter + search + paginate
    const filtered = (() => {
        let result = allThreads;

        // Filter
        switch (filter) {
            case 'unread':
                result = result.filter(t => isAdmin ? t.unreadForAdmin : t.unreadForPatient);
                break;
            case 'priority':
                result = result.filter(t => t.priority === 'high' || t.priority === 'urgent');
                break;
        }

        // Search
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            result = result.filter(t =>
                t.subject.toLowerCase().includes(q) ||
                t.lastMessage?.toLowerCase().includes(q) ||
                t.patientName?.toLowerCase().includes(q)
            );
        }

        return result;
    })();

    const threadsPage = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const hasMore = currentPage * pageSize < filtered.length;
    const totalUnread = allThreads.filter(t => isAdmin ? t.unreadForAdmin : t.unreadForPatient).length;

    const handleThreadSelect = (thread: MessageThread) => {
        setSelectedThread(thread);
    };

    const handleThreadUpdate = (updatedThread: MessageThread) => {
        // Real-time listener handles list updates automatically.
        // Just update selected thread reference.
        if (selectedThread?.id === updatedThread.id) {
            setSelectedThread(updatedThread);
        }
    };

    const handleMessageSent = async (threadId?: string) => {
        setShowNewMessage(false);
        if (threadId) {
            const response = await messageThreadOperations.getThreadById(threadId);
            if (response.success && response.data) {
                setSelectedThread(response.data);
            }
        }
    };

    if (loading && allThreads.length === 0) {
        return <LoadingSpinner />;
    }

    return (
        <div className="space-y-6">
            <PageHeader
              backTo="/dashboard"
              icon={MessageSquare}
              title="Messages"
              subtitle="Communicate with your healthcare team"
              action={
                (userProfile?.role === 'patient' || userProfile?.role === 'admin') ? (
                    <Button
                      onClick={() => setShowNewMessage(true)}
                      size="lg"
                      variant="secondary"
                      className="flex items-center justify-center !border-primary-600 !text-primary-600 hover:!bg-primary-50"
                    >
                      <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                      New
                    </Button>
                ) : undefined
              }
            />

            {/* Messages Interface — height accounts for top header (3.5rem) +
                page padding (3rem) + PageHeader card (~6rem) + gap (1.5rem) +
                footer (3.5rem) ≈ 17.5rem of chrome. 20rem leaves a small gap. */}
            <div className="h-[calc(100vh-20rem)] min-h-[400px] flex bg-surface-card rounded-lg shadow-sm border border-secondary-200 overflow-hidden">
                {/* Thread List */}
                <div className={`${
                    selectedThread ? 'hidden md:flex md:w-1/3' : 'w-full md:w-1/3'
                } md:border-r border-secondary-200 flex flex-col h-full`}>
                    {/* Search and Filters */}
                    <div className="p-4 border-b border-secondary-200 space-y-3">
                        <SearchInput
                          placeholder="Search messages..."
                          value={searchTerm}
                          onChange={setSearchTerm}
                        />

                        <div className="flex space-x-1">
                            {([
                                { key: 'all', label: 'All' },
                                { key: 'unread', label: `Unread (${totalUnread})` },
                                { key: 'priority', label: 'Priority' },
                            ] as const).map((tab) => (
                                <button
                                    key={tab.key}
                                    onClick={() => setFilter(tab.key)}
                                    className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors ${
                                        filter === tab.key
                                            ? 'border-primary-600 text-primary-600 bg-transparent'
                                            : 'border-transparent bg-secondary-100 text-secondary-600 hover:bg-secondary-200'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Thread Items */}
                    <div className="flex-1 overflow-y-auto">
                        {totalUnread > 0 && (
                            <div className="p-3 border-b border-primary-200">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-primary-600">
                                        {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
                                    </span>
                                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
                                </div>
                            </div>
                        )}

                        {threadsPage.length === 0 ? (
                            <div className="p-8 text-center text-secondary-500">
                                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>No messages found</p>
                            </div>
                        ) : (
                            threadsPage.map((thread) => {
                                const isUnread = isAdmin ? thread.unreadForAdmin : thread.unreadForPatient;

                                return (
                                    <div
                                        key={thread.id}
                                        onClick={() => handleThreadSelect(thread)}
                                        className={`p-4 border-b border-secondary-100 cursor-pointer hover:bg-secondary-50 transition-colors ${
                                            selectedThread?.id === thread.id ? 'bg-primary-50 border-primary-200' : ''
                                        } ${
                                            isUnread ? 'border-l-4 border-l-primary-500' : ''
                                        }`}
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <div className="min-w-0 flex-1">
                                                {isAdmin && thread.patientName && (
                                                    <p className={`text-xs ${isUnread ? 'font-semibold text-primary-700' : 'text-secondary-500'}`}>
                                                        {thread.patientName}
                                                    </p>
                                                )}
                                                <h3 className={`text-sm truncate ${
                                                    isUnread ? 'font-bold text-secondary-900' : 'font-normal text-secondary-700'
                                                }`}>
                                                    {thread.subject}
                                                </h3>
                                            </div>
                                            <span className="text-xs text-secondary-400 flex-shrink-0 ml-2">
                                                {formatRelative(thread.lastMessageAt)}
                                            </span>
                                        </div>

                                        {thread.lastMessage && (
                                            <p className={`text-xs text-secondary-500 truncate mb-1.5 ${
                                                isUnread ? 'font-medium' : ''
                                            }`}>
                                                {thread.lastMessage}
                                            </p>
                                        )}

                                        <div className="flex items-center space-x-2">
                                            <StatusBadge
                                                label={thread.status.replace('_', ' ')}
                                                colorClass={getThreadStatusColor(thread.status)}
                                            />
                                            {(thread.priority === 'high' || thread.priority === 'urgent') && (
                                                <span className={`w-2 h-2 rounded-full ${getPriorityTextColor(thread.priority)}`} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <PaginationBar
                      currentPage={currentPage}
                      pageSize={pageSize}
                      totalItems={filtered.length}
                      hasMore={hasMore}
                      onPreviousPage={() => setCurrentPage(currentPage - 1)}
                      onNextPage={() => setCurrentPage(currentPage + 1)}
                      label="threads"
                    />
                </div>

                {/* Message Thread View */}
                <div className={`${
                    selectedThread ? 'w-full md:flex-1' : 'hidden md:flex md:flex-1'
                } flex flex-col h-full`}>
                    {selectedThread ? (
                        <>
                            <div className="md:hidden p-4 border-b border-secondary-200">
                                <button
                                    onClick={() => setSelectedThread(null)}
                                    className="flex items-center text-primary-600 hover:text-primary-700"
                                >
                                    <ArrowLeft className="h-5 w-5 mr-2" />
                                    Back to Messages
                                </button>
                            </div>
                            <div className="flex-1 h-full">
                                <MessageThreadView
                                    thread={selectedThread}
                                    onThreadUpdate={handleThreadUpdate}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-full text-secondary-500">
                            <div className="text-center">
                                <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg">Select a message to view</p>
                                <p className="text-sm">Choose a conversation from the list</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* New Message Modal - Patient */}
            {showNewMessage && userProfile?.role === 'patient' && (
                <NewMessageModal
                    isOpen={showNewMessage}
                    onClose={() => setShowNewMessage(false)}
                    onSuccess={handleMessageSent}
                    patientId={user?.uid || ''}
                />
            )}

            {/* New Message Modal - Admin */}
            {showNewMessage && userProfile?.role === 'admin' && (
                <AdminNewMessageModal
                    isOpen={showNewMessage}
                    onClose={() => setShowNewMessage(false)}
                    onSuccess={handleMessageSent}
                />
            )}
        </div>
    );
};
