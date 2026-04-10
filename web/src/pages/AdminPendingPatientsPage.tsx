import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../hooks/useAuth';
import { usePagination } from '../hooks/usePagination';
import { dormantPatientOperations, DormantPatient } from '../lib/firestore/pending-patients';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { PaginationBar } from '../components/ui/PaginationBar';
import { EmptyState } from '../components/ui/EmptyState';
import {
  UserX,
  Search,
  X,
  Mail,
  Phone,
  Save,
  Trash2,
  Users,
  AlertTriangle,
} from 'lucide-react';

export const AdminPendingPatientsPage: React.FC = () => {
  const { userProfile, loading: authLoading } = useAuth();
  const [patients, setPatients] = useState<DormantPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const [paginationState, paginationControls] = usePagination({ initialPageSize: 10 });
  const { currentPage, pageSize, totalItems, hasNextPage } = paginationState;
  const { goToPage, setTotalItems } = paginationControls;

  const fetchPatients = async (page: number = currentPage) => {
    setLoading(true);
    try {
      const result = await dormantPatientOperations.getAll(pageSize, page, searchQuery);
      setPatients(result.patients);
      setTotalItems(result.total);
    } catch {
      setPatients([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userProfile?.role === 'admin') {
      fetchPatients(1);
      goToPage(1);
    }
  }, [userProfile, searchQuery]);

  useEffect(() => {
    if (userProfile?.role === 'admin') {
      fetchPatients(currentPage);
    }
  }, [currentPage]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    goToPage(1);
    fetchPatients(1);
  };

  const startEdit = (patient: DormantPatient) => {
    setEditingId(patient.id);
    setEditEmail(patient.email || '');
    setEditPhone(patient.phoneNumber || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditEmail('');
    setEditPhone('');
  };

  const saveContact = async (id: string) => {
    if (!editEmail && !editPhone) return;
    setSaving(true);
    try {
      const data: { email?: string; phoneNumber?: string } = {};
      if (editEmail) data.email = editEmail.toLowerCase();
      if (editPhone) data.phoneNumber = editPhone;

      const success = await dormantPatientOperations.updateContact(id, data);
      if (success) {
        cancelEdit();
        fetchPatients(currentPage);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}? This will permanently delete their record.`)) return;
    await dormantPatientOperations.remove(id);
    fetchPatients(currentPage);
  };

  if (authLoading) return <LoadingSpinner />;
  if (userProfile?.role !== 'admin') {
    return <AccessDenied message="You don't have permission to view this page." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={UserX}
        title="Dormant Patients"
        subtitle={`${totalItems} patients from DrChrono with no contact info — add email or phone to activate`}
      />

      <StatsGrid items={[
        { icon: Users, iconColor: 'bg-orange-100 text-orange-600', label: 'Dormant', value: totalItems },
        { icon: AlertTriangle, iconColor: 'bg-yellow-100 text-yellow-600', label: 'Need Contact Info', value: totalItems },
      ]} />

      {/* Search */}
      <Card className="p-6">
        <form onSubmit={handleSearch} className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {searchQuery && (
            <Button type="button" variant="ghost" onClick={() => setSearchQuery('')}>
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button type="submit">
            <Search className="h-4 w-4 mr-2" /> Search
          </Button>
        </form>
      </Card>

      {/* Patient List */}
      {loading ? (
        <LoadingSpinner />
      ) : patients.length === 0 ? (
        <EmptyState
          icon={UserX}
          title="No Dormant Patients"
          description={searchQuery ? 'No patients match your search.' : 'All patients have contact info.'}
        />
      ) : (
        <div className="space-y-3">
          {patients.map((patient) => (
            <Card key={patient.id} className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-secondary-900">
                    {patient.firstName} {patient.lastName}
                  </h3>
                  <p className="text-sm text-secondary-500 mt-1">
                    {patient.drchronoId && `DrChrono ID: ${patient.drchronoId}`}
                    {patient.gender && ` · ${patient.gender}`}
                    {patient.isMinor && ' · Minor'}
                  </p>

                  {editingId === patient.id ? (
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary-400" />
                        <Input
                          type="email"
                          placeholder="Email address"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <div className="relative flex-1">
                        <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary-400" />
                        <Input
                          type="tel"
                          placeholder="Phone number"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveContact(patient.id)}
                          disabled={saving || (!editEmail && !editPhone)}
                        >
                          <Save className="h-4 w-4 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      {patient.email && (
                        <span className="text-secondary-600 flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {patient.email}
                        </span>
                      )}
                      {patient.phoneNumber && (
                        <span className="text-secondary-600 flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {patient.phoneNumber}
                        </span>
                      )}
                      {!patient.email && !patient.phoneNumber && (
                        <span className="text-yellow-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> No contact info
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {editingId !== patient.id && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(patient)}>
                      <Mail className="h-4 w-4 mr-1" /> Add Contact
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(patient.id, `${patient.firstName} ${patient.lastName}`)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalItems > pageSize && (
        <PaginationBar
          currentPage={currentPage}
          totalItems={totalItems}
          pageSize={pageSize}
          hasMore={hasNextPage}
          onPreviousPage={() => goToPage(currentPage - 1)}
          onNextPage={() => goToPage(currentPage + 1)}
        />
      )}
    </div>
  );
};
