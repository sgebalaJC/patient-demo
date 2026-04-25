import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { userOperations, UserSortField, SortDirection } from '../lib/firestore';
import { User } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
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
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    KeyRound,
    Eye,
    RefreshCw,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { functions, auth } from '../lib/firebase';
import { isSuperAdminEmail } from '../lib/roles';
import { UserForm } from '../components/admin/UserForm';
import { PatientDocumentManagement } from '../components/admin/PatientDocumentManagement';
import { DeleteUserModal } from '../components/admin/DeleteUserModal';
import { SetPasswordModal } from '../components/admin/SetPasswordModal';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';

import { PaginationBar } from '../components/ui/PaginationBar';
import { formatPhoneDisplay } from '../lib/phone';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatDate } from '../lib/date-helpers';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';
import { alert as modalAlert } from '../lib/modals';
export const UserManagementPage: React.FC = () => {
  const { userProfile } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const isAdminUser = isAdminRole(userProfile?.role);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<User | null>(null);

  // Sort state
  const [sortBy, setSortBy] = useState<UserSortField>('lastName');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Search state — Firestore can't LIKE, so search mode falls back to the
  // fetch-all + client-filter path (userOperations.getAllUsers with a query).
  // Initial value comes from `?search=` so deep-links from other pages
  // (e.g. SMS rows linking to a matched patient) land on a filtered view.
  const [routeParams] = useSearchParams();
  const initialSearch = routeParams.get('search') || '';
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Modal targets — null means closed
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);

  const paged = usePagedCollection<User>({
    enabled: isAdminUser && !searchQuery,
    real: 'users',
    orderField: sortBy,
    orderDir: sortDir,
    pageSize: 25,
    mapDoc: (d) => ({ ...(d.data() as User), id: d.id }),
  });

  const countsPredicates = useMemo(() => ({ all: [] as [string, '==', string][] }), []);
  const { counts, refresh: refreshCounts } = useCollectionCounts({
    enabled: isAdminUser,
    real: 'users',
    predicates: countsPredicates,
  });

  // Search mode: fall back to the existing fetch-all + client-filter path.
  useEffect(() => {
    if (!isAdminUser || !searchQuery) { setSearchResults([]); return; }
    let cancelled = false;
    setSearchLoading(true);
    userOperations.getAllUsers(500, 1, searchQuery, sortBy, sortDir, null, 'first', simulated).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setSearchResults(res.data.users);
      else setSearchResults([]);
    }).catch((err) => {
      if (!cancelled) logger.error('user search failed', err);
    }).finally(() => {
      if (!cancelled) setSearchLoading(false);
    });
    return () => { cancelled = true; };
  }, [isAdminUser, searchQuery, sortBy, sortDir, simulated]);

  const users = searchQuery ? searchResults : paged.rows;
  const loading = searchQuery ? searchLoading : paged.loading;
  const totalItems = searchQuery ? searchResults.length : counts.all;

  const refreshAll = () => {
    if (searchQuery) {
      // Re-run search: setting to same value doesn't re-fire effect, so bump via identity.
      setSearchQuery(searchQuery);
      // trigger via state — force by clearing+restoring
      setSearchResults([]);
      setSearchLoading(true);
      userOperations.getAllUsers(500, 1, searchQuery, sortBy, sortDir, null, 'first', simulated).then((res) => {
        if (res.success && res.data) setSearchResults(res.data.users);
      }).finally(() => setSearchLoading(false));
    } else {
      paged.refresh();
      refreshCounts();
    }
  };

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
        // Flag sim-seeded targets so AuthContext loads their profile from
        // simulation/native/users/<uid> — they don't exist in real users/.
        simulated,
      }));
      try {
        await signInWithCustomToken(auth, res.data.token);
        // Full reload, not SPA navigate: AuthContext doesn't reset `loading`
        // when the auth identity flips, so a SPA navigation runs role-based
        // redirects against the *previous* (admin) profile and lands on
        // /admin. A hard reload remounts everything against the fresh patient
        // identity so RoleBasedRedirect picks /dashboard and the banner shows
        // immediately instead of after the operator manually reloads.
        window.location.assign('/');
      } catch (signInErr) {
        sessionStorage.removeItem('impersonation');
        throw signInErr;
      }
    } catch (err: any) {
      logger.error('Impersonation failed:', err);
      void modalAlert({ tone: 'error', title: 'Impersonation failed', message: err?.message || 'Unknown error' });
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
    refreshAll();
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

  const toggleSort = (field: UserSortField) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  if (loading && users.length === 0 && paged.page === 1 && !searchQuery) {
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
          <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm" className="flex items-center">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
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
                      {isSuperAdminEmail(userProfile?.email) && user.id !== userProfile?.id && (
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
                        onClick={() => setPasswordTarget(user)}
                        className="!px-2"
                        title="Set password"
                        aria-label="Set password"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setUserToDelete(user)}
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

            {!searchQuery && (
              <PaginationBar
                currentPage={paged.page}
                pageSize={paged.pageSize}
                totalItems={(paged.page - 1) * paged.pageSize + paged.rows.length + (paged.hasNext ? 1 : 0)}
                hasMore={paged.hasNext}
                onPreviousPage={paged.prev}
                onNextPage={paged.next}
                label="users"
              />
            )}
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

      <DeleteUserModal
        user={userToDelete}
        onClose={() => setUserToDelete(null)}
        onDeleted={() => {
          setUserToDelete(null);
          refreshAll();
        }}
      />

      <SetPasswordModal
        user={passwordTarget}
        onClose={() => setPasswordTarget(null)}
      />
    </div>
    </AdminGuard>
  );
};