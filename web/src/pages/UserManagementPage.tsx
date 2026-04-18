import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { userOperations, UserSortField, SortDirection } from '../lib/firestore';
import { User } from '../types';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import {
    Users,
    Plus,
    Edit,
    Mail,
    Shield,
    User as UserIcon,
    Search,
    X,
    FileText,
    Trash2,
    AlertTriangle,
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    Send,
    CheckCircle2,
    KeyRound,
    Eye,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { functions, auth } from '../lib/firebase';
import { sendInviteLink } from '../lib/firebase';
import { isSuperAdminRole } from '../lib/roles';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { UserForm } from '../components/admin/UserForm';
import { PatientDocumentManagement } from '../components/admin/PatientDocumentManagement';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';

import { PaginationBar } from '../components/ui/PaginationBar';
import { formatPhoneDisplay } from '../lib/phone';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { formatDate } from '../lib/date-helpers';
import { DocumentSnapshot } from 'firebase/firestore';
import logger from '../lib/logger';
export const UserManagementPage: React.FC = () => {
  const { userProfile } = useAuth();
  const { settings: appSettings } = useAppSettings();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<User | null>(null);

  // Resend-invite state
  const [resendingInviteFor, setResendingInviteFor] = useState<string | null>(null);
  const [resendInviteFlash, setResendInviteFlash] = useState<{ uid: string; ok: boolean } | null>(null);

  // Pagination state (cursor-based) — page size from app settings
  const pageSize = appSettings.paginationSize;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [firstDoc, setFirstDoc] = useState<DocumentSnapshot | null>(null);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);

  // Sort state
  const [sortBy, setSortBy] = useState<UserSortField>('lastName');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Delete user state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Set-password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Fetch stats once on mount
  useEffect(() => {
    if (isAdminRole(userProfile?.role)) {

    }
  }, [userProfile]);

  // Fetch users when search, sort, page size, or page 1 reset
  useEffect(() => {
    if (isAdminRole(userProfile?.role)) {
      fetchUsers('first');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, searchQuery, sortBy, sortDir, pageSize]);

  const handleResendInvite = async (user: User) => {
    if (!user.email) return;
    setResendingInviteFor(user.id);
    setResendInviteFlash(null);
    try {
      await sendInviteLink(user.email);
      setResendInviteFlash({ uid: user.id, ok: true });
    } catch (err: any) {
      logger.error('Resend invite failed:', err);
      setResendInviteFlash({ uid: user.id, ok: false });
    } finally {
      setResendingInviteFor(null);
      setTimeout(() => setResendInviteFlash(null), 4000);
    }
  };

  const fetchUsers = useCallback(async (direction: 'first' | 'next' | 'prev' = 'first') => {
    if (!userProfile) return;

    setLoading(true);
    try {
      const cursorDoc = direction === 'next' ? lastDoc : direction === 'prev' ? firstDoc : null;
      const newPage = direction === 'next' ? currentPage + 1 : direction === 'prev' ? Math.max(1, currentPage - 1) : 1;

      const response = await userOperations.getAllUsers(
        pageSize, newPage, searchQuery, sortBy, sortDir, cursorDoc, direction
      );

      if (response.success && response.data) {
        setUsers(response.data.users);
        setTotalItems(response.data.total);
        setHasMore(response.data.hasMore);
        setFirstDoc(response.data.firstDoc);
        setLastDoc(response.data.lastDoc);
        setCurrentPage(newPage);
      } else {
        setUsers([]);
        setTotalItems(0);
      }
    } catch (error) {
      setUsers([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  }, [userProfile, searchQuery, sortBy, sortDir, lastDoc, firstDoc, currentPage]);

  const handleAddUser = () => {
    setEditingUser(null);
    setIsFormOpen(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setIsFormOpen(true);
  };

  const handleImpersonate = async (targetUser: User) => {
    try {
      const impersonateUser = httpsCallable<{ targetUid: string }, { token: string }>(
        functions, 'impersonateUser'
      );
      const res = await impersonateUser({ targetUid: targetUser.id });
      // Set the flag BEFORE sign-in: signInWithCustomToken synchronously
      // triggers AuthContext's onAuthStateChanged, which reads this flag to
      // decide whether to show the impersonation banner. Setting it after
      // causes the banner to stay hidden until the next reload.
      sessionStorage.setItem('impersonation', JSON.stringify({
        realEmail: userProfile?.email,
        targetName: `${targetUser.firstName} ${targetUser.lastName}`,
      }));
      try {
        await signInWithCustomToken(auth, res.data.token);
      } catch (signInErr) {
        sessionStorage.removeItem('impersonation');
        throw signInErr;
      }
    } catch (err: any) {
      logger.error('Impersonation failed:', err);
      alert('Impersonation failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleManageDocuments = (user: User) => {
    setSelectedPatient(user);
    setIsDocumentModalOpen(true);
  };

  const handleDocumentModalClose = () => {
    setIsDocumentModalOpen(false);
    setSelectedPatient(null);
  };

  const handleFormSuccess = () => {
    fetchUsers('first');
    setIsFormOpen(false);
    setEditingUser(null);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingUser(null);
  };

  // Search handlers
  const handleSearch = () => {
    if (searchInput.trim() !== searchQuery) {
      setSearchQuery(searchInput.trim());
    }
  };

  const handleSearchReset = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete || deleteConfirmText !== 'DELETE') return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../lib/firebase');
      const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
      const result = await deleteAccountFn({ targetUserId: userToDelete.id }) as { data: { success: boolean; error?: string } };

      if (result.data.success) {
        setShowDeleteModal(false);
        setUserToDelete(null);
        setDeleteConfirmText('');
        fetchUsers('first');
  
      } else {
        setDeleteError(result.data.error || 'Failed to delete user');
      }
    } catch (error: any) {
      logger.error('Error deleting user:', error);
      setDeleteError(error.message || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  const openSetPassword = (user: User) => {
    setPasswordTarget(user);
    setNewPassword('');
    setNewPasswordConfirm('');
    setPasswordError(null);
    setPasswordSaved(false);
    setShowPasswordModal(true);
  };

  const closeSetPassword = () => {
    if (passwordSaving) return;
    setShowPasswordModal(false);
    setPasswordTarget(null);
    setNewPassword('');
    setNewPasswordConfirm('');
    setPasswordError(null);
    setPasswordSaved(false);
  };

  const handleSetPassword = async () => {
    if (!passwordTarget) return;
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    if (newPassword.length > 128) {
      setPasswordError('Password must be less than 128 characters');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    try {
      const { firebaseService } = await import('../lib/firebase');
      const result = await firebaseService.setUserPassword(passwordTarget.id, newPassword);
      if (result?.success) {
        setPasswordSaved(true);
        setNewPassword('');
        setNewPasswordConfirm('');
      } else {
        setPasswordError(result?.error || 'Failed to set password');
      }
    } catch (err: any) {
      // Password intentionally not logged.
      logger.error('Set password failed:', { code: err.code, message: err.message });
      setPasswordError(err.message || 'Failed to set password');
    } finally {
      setPasswordSaving(false);
    }
  };

  const toggleSort = (field: UserSortField) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  if (loading) {
    return <AdminGuard><LoadingSpinner /></AdminGuard>;
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={Users}
        title="User Management"
        subtitle={`Total: ${totalItems} users${searchQuery ? ` (filtered by "${searchQuery}")` : ''}`}
        action={
          <Button onClick={handleAddUser} className="flex items-center justify-center w-full sm:w-auto" size="lg">
            <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
            Add User
          </Button>
        }
      />


      {/* Search & Sort Section */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input
              type="text"
              placeholder="Search users by name, email, or phone..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} size="sm" className="flex items-center">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          {(searchQuery || searchInput) && (
            <Button
              variant="secondary"
              onClick={handleSearchReset}
              size="sm"
              className="flex items-center"
            >
              <X className="h-4 w-4 mr-2" />
              Reset
            </Button>
          )}
        </div>

        {/* Sort controls */}
        {!searchQuery && (
          <div className="flex items-center space-x-2 text-sm">
            <ArrowUpDown className="h-4 w-4 text-secondary-400" />
            <span className="text-secondary-500">Sort by:</span>
            {([['lastName', 'Name'], ['createdAt', 'Date Added']] as [UserSortField, string][]).map(([field, label]) => (
              <button
                key={field}
                onClick={() => toggleSort(field)}
                className={`px-3 py-1.5 rounded-lg flex items-center space-x-1 transition-colors ${
                  sortBy === field
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'text-secondary-600 hover:bg-secondary-100'
                }`}
              >
                <span>{label}</span>
                {sortBy === field && (
                  sortDir === 'asc'
                    ? <ChevronUp className="h-3.5 w-3.5" />
                    : <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            ))}
          </div>
        )}

        {searchQuery && (
          <div className="text-sm text-secondary-600">
            Showing {totalItems} user{totalItems !== 1 ? 's' : ''} matching "{searchQuery}"
          </div>
        )}
      </Card>

      {/* Users List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-secondary-900">
          Users {searchQuery ? `(Search Results)` : ''}
        </h2>
        {users.length === 0 ? (
          <Card className="p-8 text-center">
            <Users className="h-16 w-16 text-secondary-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-secondary-900 mb-2">
              {searchQuery ? 'No Users Match Your Search' : 'No Users Found'}
            </h3>
            <p className="text-secondary-600 mb-4">
              {searchQuery 
                ? `No users found matching "${searchQuery}". Try a different search term.`
                : 'No users are currently registered in the system.'
              }
            </p>
            {!searchQuery && (
              <Button onClick={handleAddUser}>
                <Plus className="h-5 w-5 mr-2" />
                Add User
              </Button>
            )}
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6">
              {users.map((user) => (
                <Card key={user.id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start space-x-4">
                      <div className="p-3 rounded-lg bg-primary-50">
                        {isAdminRole(user.role) ? (
                          <Shield className="h-8 w-8 text-primary-600" />
                        ) : (
                          <UserIcon className="h-8 w-8 text-primary-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-secondary-900">
                          {`${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown User'}
                        </h3>
                        <StatusBadge
                          label={user.role}
                          colorClass="capitalize bg-primary-50 text-primary-700"
                        />
                        <div className="flex items-center mt-2 space-x-4">
                          <div className="flex items-center text-sm text-secondary-600">
                            <Mail className="h-4 w-4 mr-1" />
                            {user.email || formatPhoneDisplay(user.phoneNumber) || 'No contact info'}
                          </div>
                        </div>
                        {user.role === 'patient' && user.dateOfBirth && (
                          <p className="text-sm text-secondary-600 mt-1">
                            DOB: {formatDate(user.dateOfBirth)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {user.role === 'patient' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleManageDocuments(user)}
                          className="text-primary-600 hover:text-primary-700 !px-2"
                          title="Manage documents"
                          aria-label="Manage documents"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      )}
                      {user.email && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleResendInvite(user)}
                          loading={resendingInviteFor === user.id}
                          className={`!px-2 ${
                            resendInviteFlash?.uid === user.id && resendInviteFlash.ok
                              ? 'text-green-600 hover:text-green-700'
                              : resendInviteFlash?.uid === user.id && !resendInviteFlash.ok
                              ? 'text-red-600 hover:text-red-700'
                              : ''
                          }`}
                          title="Send a fresh sign-in link"
                          aria-label="Send sign-in link"
                        >
                          {resendInviteFlash?.uid === user.id && resendInviteFlash.ok ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {isSuperAdminRole(userProfile?.role) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleImpersonate(user)}
                          className="!px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          title="Impersonate user"
                          aria-label="Impersonate user"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEditUser(user)}
                        className="!px-2"
                        title="Edit user"
                        aria-label="Edit user"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openSetPassword(user)}
                        className="!px-2"
                        title="Set password"
                        aria-label="Set password"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setUserToDelete(user);
                          setShowDeleteModal(true);
                          setDeleteConfirmText('');
                          setDeleteError(null);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 !px-2"
                        title="Delete user"
                        aria-label="Delete user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-secondary-200 pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <StatusBadge
                          label={user.isActive ? 'Active' : 'Inactive'}
                          colorClass={user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                        />
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-secondary-500">
                          Joined {user.createdAt && typeof user.createdAt.toDate === 'function'
                            ? formatDate(user.createdAt)
                            : 'Unknown'}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <PaginationBar
              currentPage={currentPage}
              pageSize={pageSize}
              totalItems={totalItems}
              hasMore={hasMore}
              onPreviousPage={() => fetchUsers('prev')}
              onNextPage={() => fetchUsers('next')}
              label="users"
            />
          </>
        )}
      </div>

      {/* User Form Modal */}
      <UserForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        onSuccess={handleFormSuccess}
        editingUser={editingUser}
      />

      {/* Patient Document Management Modal */}
      <PatientDocumentManagement
        isOpen={isDocumentModalOpen}
        onClose={handleDocumentModalClose}
        patient={selectedPatient}
      />

      {/* Delete User Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setUserToDelete(null);
          setDeleteConfirmText('');
          setDeleteError(null);
        }}
        title={`Delete User — ${userToDelete ? `${userToDelete.firstName} ${userToDelete.lastName}`.trim() : ''}`}
        icon={<div className="bg-red-100 p-2 rounded-lg"><AlertTriangle className="h-6 w-6 text-red-600" /></div>}
        maxWidth="max-w-md"
      >
        <div className="p-6 space-y-4">
          <ErrorAlert message={deleteError} />

          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800 font-medium">This will permanently delete:</p>
            <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside">
              <li>User account and profile</li>
              <li>All messages and conversations</li>
              <li>All uploaded documents</li>
              <li>Appointment history</li>
              <li>Prescription refill requests</li>
              <li>Intake forms and medical history</li>
            </ul>
          </div>

          {userToDelete && (
            <div className="bg-secondary-50 rounded-lg p-3 text-sm text-secondary-700">
              <p><strong>User:</strong> {userToDelete.firstName} {userToDelete.lastName}</p>
              <p><strong>{userToDelete.email ? 'Email' : 'Phone'}:</strong> {userToDelete.email || userToDelete.phoneNumber}</p>
              <p><strong>Role:</strong> {userToDelete.role}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-2">
              Type <span className="font-bold">DELETE</span> to confirm
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setShowDeleteModal(false);
                setUserToDelete(null);
                setDeleteConfirmText('');
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              size="md"
              onClick={handleDeleteUser}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              loading={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete User
            </Button>
          </div>
        </div>
      </Modal>

      {/* Set Password Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={closeSetPassword}
        title={`Set Password — ${passwordTarget ? `${passwordTarget.firstName} ${passwordTarget.lastName}`.trim() : ''}`}
        icon={<div className="bg-primary-100 p-2 rounded-lg"><KeyRound className="h-6 w-6 text-primary-600" /></div>}
        maxWidth="max-w-md"
      >
        <div className="p-6 space-y-4">
          <ErrorAlert message={passwordError} />

          {passwordSaved ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800 flex items-start space-x-2">
              <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <span>
                Password updated. The user can now sign in with their email and the new password.
                Share the password through a secure channel — it isn't stored or shown again.
              </span>
            </div>
          ) : (
            <>
              <p className="text-sm text-secondary-600">
                Set a password so this user can sign in with email + password in addition
                to email-link / Google / phone OTP. Minimum 8 characters.
              </p>

              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  New password
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  disabled={passwordSaving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Confirm password
                </label>
                <Input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  disabled={passwordSaving}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={closeSetPassword}
              disabled={passwordSaving}
            >
              {passwordSaved ? 'Close' : 'Cancel'}
            </Button>
            {!passwordSaved && (
              <Button
                size="md"
                onClick={handleSetPassword}
                loading={passwordSaving}
                disabled={passwordSaving || newPassword.length < 8 || newPassword !== newPasswordConfirm}
              >
                <KeyRound className="h-4 w-4 mr-2" />
                Set Password
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
    </AdminGuard>
  );
};