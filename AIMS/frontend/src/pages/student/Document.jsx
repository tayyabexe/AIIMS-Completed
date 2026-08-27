import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { students as studentsApi } from '../../api/endpoints';
import { assetUrl } from '../../api/client';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import './StudentDashboard.css';
import './Document.css';
import { Skeleton, SkeletonCardGrid } from '../../components/common/Skeleton';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconAlertCircle, IconChevronRight,
} from '../../components/student/icons';

/* ── Small helper icon used in stats ── */
const IconCheckCircle = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── Inline document-specific icons ── */
const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 3v12M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);



const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M5 7h14M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M19 7l-1 13a1.5 1.5 0 01-1.5 1.4H7.5A1.5 1.5 0 016 20L5 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const IconPDF = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="4" y="2" width="16" height="20" rx="2" stroke="#dc2626" strokeWidth="1.4" />
    <path d="M8 10h3v3H8zM13 10h3v5h-3z" stroke="#dc2626" strokeWidth="1.2" />
    <path d="M8 15h8" stroke="#dc2626" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IconDocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="4" y="2" width="16" height="20" rx="2" stroke="#2563eb" strokeWidth="1.4" />
    <path d="M8 9h8M8 13h8M8 17h5" stroke="#2563eb" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const IconImageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="4" y="2" width="16" height="20" rx="2" stroke="#7c3aed" strokeWidth="1.4" />
    <circle cx="9" cy="8.5" r="1.5" stroke="#7c3aed" strokeWidth="1.2" />
    <path d="M7 16l3-3 2 2 3-3 3 4" stroke="#7c3aed" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconFormIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="4" y="2" width="16" height="20" rx="2" stroke="#d97706" strokeWidth="1.4" />
    <path d="M8 6h8M8 10h3" stroke="#d97706" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="16" cy="11" r="2" stroke="#d97706" strokeWidth="1.2" />
    <path d="M12 13l4-2" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IconFolder = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconMore = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="5" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" />
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCloudUpload = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 16V4M8 8l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 16.7A4.5 4.5 0 0017.5 8h-1.1A7 7 0 104 14.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── Document data ── */
/* student_documents.doc_type is an ENUM; these are exactly its values, so an
   upload can never be rejected for a category the database does not have. */
const UPLOAD_CATEGORIES = [
  'CNIC', 'B-Form', 'Photo', 'Certificate', 'Transcript', 'Medical',
  'Admission Form', 'Fee Challan', 'Result Card', 'Other',
];
const CATEGORIES = ['All', 'Academic', 'ID Cards', 'Certificates', 'Forms', 'Other'];

/*
 * How a `student_documents` row maps onto the card this page renders.
 *
 * The table stores doc_id, doc_type, file_url, verified and uploaded_at. It
 * does not store a display name, a reference code or a file size, so those are
 * derived from the filename and type rather than invented.
 */
const DOC_TYPE_CATEGORY = {
  CNIC: 'ID Cards',
  'B-Form': 'ID Cards',
  Photo: 'ID Cards',
  Certificate: 'Certificates',
  Transcript: 'Academic',
  'Result Card': 'Academic',
  'Admission Form': 'Forms',
  'Fee Challan': 'Forms',
  Medical: 'Other',
  Other: 'Other',
};

const CATEGORY_COLOR = {
  Academic: '#b91c2c',
  'ID Cards': '#7c3aed',
  Certificates: '#2563eb',
  Forms: '#d97706',
  Other: '#6b7280',
};

const fileTypeOf = (url) => {
  const ext = String(url || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  return 'doc';
};

const toDocument = (row) => {
  const category = DOC_TYPE_CATEGORY[row.doc_type] || 'Other';
  // Split on both separators: seeded rows use "uploads/students/13/cnic.pdf"
  // while rows written by multer on Windows use "uploads\1785134516270.png".
  const fileName = String(row.file_url || '').split(/[\\/]/).pop() || 'document';

  return {
    id: row.doc_id,
    category,
    // The row has no title, so the stored filename is the name.
    name: fileName,
    code: `${row.doc_type || 'DOC'}-${row.doc_id}`,
    docType: row.doc_type,
    type: fileTypeOf(row.file_url),
    fileUrl: row.file_url,
    // No `size`: student_documents records no file size, so the UI omits it
    // rather than showing a made-up one.
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).getTime() : 0,
    uploaded: row.uploaded_at
      ? new Date(row.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—',
    status: row.verified ? 'Verified' : 'Pending',
    color: CATEGORY_COLOR[category] || '#6b7280',
  };
};

/* ── Helper: detect file type from mime / extension ── */
const detectFileType = (file) => {
  if (!file) return 'doc';
  const ext = file.name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'image';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'form';
  return 'doc';
};

/* ── Helper: format bytes ── */
const formatSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

/* ── Helper: color per type ── */
const typeColor = (type) => {
  switch (type) {
    case 'pdf': return '#b91c2c';
    case 'image': return '#7c3aed';
    case 'form': return '#d97706';
    default: return '#6b7280';
  }
};

/* ── Helper: icon per type ── */
const typeIcon = (type) => {
  switch (type) {
    case 'pdf': return <IconPDF />;
    case 'image': return <IconImageIcon />;
    case 'form': return <IconFormIcon />;
    default: return <IconDocIcon />;
  }
};

/* ── Helper: status pill color ── */
const statusClass = (s) => {
  if (s === 'Verified' || s === 'Approved') return 'verified';
  if (s === 'Pending' || s === 'Submitted') return 'pending';
  return 'draft';
};

/* ══════════════════════════════════════════════════
   Upload Modal Component
   ══════════════════════════════════════════════════ */

const UploadModal = ({ onClose, onUpload }) => {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [docCategory, setDocCategory] = useState('Other');
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    // Enforce 10 MB limit
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size exceeds the 10 MB limit. Please choose a smaller file.');
      return;
    }
    setUploadError(null);
    setSelectedFile(file);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleInputChange = useCallback((e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = null;
  }, [handleFile]);

  /**
   * Sends the file to the server. This used to run a 1.5s fake delay and then
   * hand a locally-built row to the parent, inventing a reference code from
   * `Math.random()`; nothing was ever uploaded.
   */
  const handleConfirm = useCallback(async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);
    try {
      await onUpload({ file: selectedFile, docType: docCategory });
      setUploading(false);
      setUploadSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setUploading(false);
      setUploadError(err.message || 'Upload failed. Please try again.');
    }
  }, [selectedFile, docCategory, onUpload, onClose]);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setUploadError(null);
  }, []);

  // Close on Escape key
  React.useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className="upload-modal-overlay" onClick={onClose}>
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="upload-modal-header">
          <div className="upload-modal-title-row">
            <span className="upload-modal-icon"><IconUpload /></span>
            <div>
              <h2 className="upload-modal-title">Upload Document</h2>
              <p className="upload-modal-subtitle">Add a new document to your collection</p>
            </div>
          </div>
          <button className="upload-modal-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {uploadSuccess ? (
          /* Success state */
          <div className="upload-success-state">
            <div className="upload-success-icon">
              <IconCheck />
            </div>
            <h3 className="upload-success-title">Document Uploaded!</h3>
            <p className="upload-success-text">
              "{selectedFile?.name}" has been uploaded successfully and is pending verification.
            </p>
          </div>
        ) : (
          /* Form state */
          <div className="upload-modal-body">
            {/* Drop zone */}
            <div
              className={`upload-dropzone ${isDragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !selectedFile && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="upload-file-input"
                onChange={handleInputChange}
                accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv"
              />

              {selectedFile ? (
                <div className="upload-file-info">
                  <div className="upload-file-icon">
                    {typeIcon(detectFileType(selectedFile))}
                  </div>
                  <div className="upload-file-details">
                    <span className="upload-file-name">{selectedFile.name}</span>
                    <span className="upload-file-size">{formatSize(selectedFile.size)}</span>
                  </div>
                  <button
                    className="upload-file-remove"
                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(); }}
                    aria-label="Remove file"
                  >
                    <IconClose />
                  </button>
                </div>
              ) : (
                <div className="upload-dropzone-content">
                  <div className="upload-dropzone-icon">
                    <IconCloudUpload />
                  </div>
                  <p className="upload-dropzone-title">
                    Drag & drop your file here
                  </p>
                  <p className="upload-dropzone-subtitle">
                    or <span className="upload-browse-link">browse</span> to choose a file
                  </p>
                  <p className="upload-dropzone-hint">
                    Supports PDF, JPG, PNG, DOC, DOCX, XLS (max 10 MB)
                  </p>
                </div>
              )}
            </div>

            {/* No "Document Name" field: POST /api/students/upload-document
                stores only the file and its doc_type, so a display name the
                user typed would be discarded. The stored filename is the name. */}

            {uploadError && (
              <div className="upload-error" role="alert">
                <IconAlertCircle />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Category */}
            <div className="upload-field">
              <label className="upload-label" htmlFor="doc-category">Category</label>
              <div className="upload-category-pills">
                {UPLOAD_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`upload-category-pill ${docCategory === cat ? 'active' : ''}`}
                    onClick={() => setDocCategory(cat)}
                    type="button"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!uploadSuccess && (
          <div className="upload-modal-footer">
            <button className="upload-cancel-btn" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button
              className="upload-confirm-btn"
              onClick={handleConfirm}
              disabled={!selectedFile || uploading}
            >
              {uploading ? (
                <>
                  <span className="upload-spinner"></span>
                  Uploading...
                </>
              ) : (
                <>
                  <IconUpload />
                  Upload Document
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════ */

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

/* ══════════════════════════════════════════════════
   Preview Modal Component
   ══════════════════════════════════════════════════ */

const PreviewModal = ({ doc, profile, onClose }) => {
  React.useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!doc) return null;

  const getPreviewContent = () => {
    switch (doc.type) {
      case 'pdf':
        return (
          <div className="preview-pdf">
            <div className="preview-pdf-icon"><IconPDF /></div>
            <h3>{doc.name}</h3>
            <p className="preview-code">{doc.code}</p>
            <div className="preview-pdf-preview">
              <div className="preview-pdf-page">
                <div className="preview-pdf-header">
                  <div className="preview-pdf-logo"></div>
                  <span>AIIMS Institute</span>
                </div>
                <div className="preview-pdf-line long"></div>
                <div className="preview-pdf-line medium"></div>
                <div className="preview-pdf-line short"></div>
                <div className="preview-pdf-line long"></div>
                <div className="preview-pdf-line medium"></div>
                <div className="preview-pdf-table">
                  <div className="preview-pdf-table-row header">
                    <span>Subject</span><span>Marks</span><span>Grade</span>
                  </div>
                  <div className="preview-pdf-table-row"><span>AI/ML</span><span>88</span><span>A</span></div>
                  <div className="preview-pdf-table-row"><span>DB Systems</span><span>82</span><span>B+</span></div>
                  <div className="preview-pdf-table-row"><span>Software Eng.</span><span>90</span><span>A</span></div>
                </div>
                <div className="preview-pdf-line long"></div>
                <div className="preview-pdf-line short"></div>
              </div>
            </div>
          </div>
        );
      case 'image':
        return (
          <div className="preview-image">
            <div className="preview-image-placeholder">
              <IconImageIcon />
              <h3>{doc.name}</h3>
              <p className="preview-code">{doc.code}</p>
              <div className="preview-image-frame">
                <div className="preview-image-inner">
                  <div className="preview-img-placeholder-icon"><IconImageIcon /></div>
                  <span>Image Preview</span>
                  {/* File size intentionally absent — not stored by student_documents. */}
                </div>
              </div>
            </div>
          </div>
        );
      case 'form':
        return (
          <div className="preview-form">
            <div className="preview-form-icon"><IconFormIcon /></div>
            <h3>{doc.name}</h3>
            <p className="preview-code">{doc.code}</p>
            <div className="preview-form-fields">
              <div className="preview-form-field">
                <span className="preview-form-label">Student Name</span>
                <div className="preview-form-value">{profile?.fullName || '—'}</div>
              </div>
              <div className="preview-form-field">
                <span className="preview-form-label">Roll No.</span>
                <div className="preview-form-value">{profile?.rollNo || '—'}</div>
              </div>
              <div className="preview-form-field">
                <span className="preview-form-label">Date</span>
                <div className="preview-form-value">{doc.uploaded}</div>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div className="preview-doc">
            <div className="preview-doc-icon"><IconDocIcon /></div>
            <h3>{doc.name}</h3>
            <p className="preview-code">{doc.code}</p>
            <div className="preview-doc-content">
              <div className="preview-doc-line long"></div>
              <div className="preview-doc-line medium"></div>
              <div className="preview-doc-line long"></div>
              <div className="preview-doc-line short"></div>
              <div className="preview-doc-line long"></div>
              <div className="preview-doc-line medium"></div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="upload-modal-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <div className="upload-modal-title-row">
            <span className="upload-modal-icon"><IconEye /></span>
            <div>
              <h2 className="upload-modal-title">Document Preview</h2>
              <p className="upload-modal-subtitle">{doc.name} — {doc.category}</p>
            </div>
          </div>
          <button className="upload-modal-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="preview-body">
          {getPreviewContent()}
        </div>
        <div className="upload-modal-footer">
          <span className="preview-doc-info">
            <span className="preview-info-label">Status:</span>
            <span className={`doc-status-pill ${statusClass(doc.status)}`}>{doc.status}</span>
          </span>
          <button className="upload-confirm-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════
   Delete Confirmation Modal
   ══════════════════════════════════════════════════ */

const DeleteConfirmModal = ({ doc, onConfirm, onCancel }) => {
  React.useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onCancel]);

  if (!doc) return null;

  return (
    <div className="upload-modal-overlay" onClick={onCancel}>
      <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-icon-wrap">
          <IconTrash />
        </div>
        <h3 className="delete-title">Delete Document?</h3>
        <p className="delete-text">
          Are you sure you want to delete <strong>"{doc.name}"</strong>? This action cannot be undone.
        </p>
        <div className="delete-actions">
          <button className="upload-cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="delete-confirm-btn" onClick={() => onConfirm(doc.id)}>
            <IconTrash />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════ */

const Document = () => {
  const { profile } = useStudentProfile();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [deleteDoc, setDeleteDoc] = useState(null);

  /**
   * The student's real documents, from GET /api/students/documents/:id.
   *
   * Twelve invented rows used to be hardcoded here ("Semester 6 Marksheet",
   * "Character Certificate", …) with made-up sizes, codes and dates. The
   * student_documents table has held the real ones all along.
   */
  const loadDocuments = useCallback(async () => {
    if (!profile.studentId) return;

    setLoading(true);
    setLoadError(null);
    try {
      const res = await studentsApi.documents(profile.studentId);
      const rows = Array.isArray(res?.documents) ? res.documents
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res) ? res : [];

      // The API returns rows in insertion order, so sort newest-first here —
      // otherwise "Recent Uploads" would show the oldest five.
      setDocuments(rows.map(toDocument).sort((a, b) => b.uploadedAt - a.uploadedAt));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [profile.studentId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents', active: true },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  /* ── Compute stats from current documents ──
     No storage figure is shown: student_documents records no file size, and
     there is no per-student quota anywhere in the schema. The old card built
     one from `10.6 + pendingCount * 0.3` MB against a 50 MB limit, both
     invented. */
  const docStats = {
    total: documents.length,
    verified: documents.filter((d) => d.status === 'Verified').length,
    pending: documents.filter((d) => d.status === 'Pending').length,
  };

  /* ── Recent uploads (latest 5) ── */
  const recentUploads = [...documents].slice(0, 5);

  /* ── Filter documents ── */
  const filteredDocs = documents.filter((d) => {
    const matchCategory = activeCategory === 'All' || d.category === activeCategory;
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.code.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q);
    return matchCategory && matchSearch;
  });

  /**
   * Uploads the chosen file to POST /api/students/upload-document and reloads
   * the list. The modal previously only pushed a row into local state, so the
   * "uploaded" document vanished on refresh and never reached the server.
   */
  const handleUpload = useCallback(async ({ file, docType }) => {
    if (!file || !profile.studentId) return;

    const form = new FormData();
    form.append('document', file);
    form.append('student_id', profile.studentId);
    form.append('doc_type', docType || 'Other');

    await studentsApi.uploadDocument(form);
    await loadDocuments();
  }, [profile.studentId, loadDocuments]);

  /**
   * Opens the stored file. It used to generate a text file describing the
   * document and download that instead — the note in it even said "This is a
   * simulated document download".
   */
  const handleDownload = useCallback((doc) => {
    const href = assetUrl(doc.fileUrl);
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  /* ── Handle delete ── */
  const handleDeleteConfirm = useCallback(async (docId) => {
    setDeleteDoc(null);
    try {
      await studentsApi.removeDocument(docId);
      await loadDocuments();
    } catch {
      // Reload either way so the list reflects the server, not an optimistic
      // removal that may not have happened.
      await loadDocuments();
    }
  }, [loadDocuments]);

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconCap2 /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2024</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">
        {/* ── Top header (shared: chatbot, notifications, profile) ── */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* ── Breadcrumb ── */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Documents</span>
        </div>

        {/* ── Page content ── */}
        <div className="doc-page">

          {/* ── Page header ── */}
          <div className="doc-page-header">
            <div>
              <h1 className="doc-title">Documents</h1>
              <p className="doc-subtitle">Manage your academic &amp; personal documents</p>
            </div>
            <div className="doc-header-actions">
              <button className="doc-upload-btn" onClick={() => setShowUploadModal(true)}>
                <IconUpload />
                <span>Upload</span>
              </button>
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="doc-stats-row">
            <div className="doc-stat-card">
              <span className="doc-stat-icon docs"><IconFolder /></span>
              <div className="doc-stat-info">
                <span className="doc-stat-value">{docStats.total}</span>
                <span className="doc-stat-label">Total Documents</span>
              </div>
            </div>
            <div className="doc-stat-card">
              <span className="doc-stat-icon verified"><IconCheckCircle /></span>
              <div className="doc-stat-info">
                <span className="doc-stat-value">{docStats.verified}</span>
                <span className="doc-stat-label">Verified</span>
              </div>
            </div>
            <div className="doc-stat-card">
              <span className="doc-stat-icon pending"><IconAlertCircle /></span>
              <div className="doc-stat-info">
                <span className="doc-stat-value">{docStats.pending}</span>
                <span className="doc-stat-label">Pending / Draft</span>
              </div>
            </div>
            {/* No "Storage Used" card: student_documents stores no file size and
                the schema has no per-student quota, so there is nothing real to
                show here. */}
          </div>

          {/* ── Category pills + document count ── */}
          <div className="doc-filter-bar">
            {/* This list used to be filtered from the header search box. That
                box is now the portal-wide "jump to a module" search, so the
                page keeps its own filter for name / code / category. */}
            <div className="doc-inline-search">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter documents by name, code or category..."
                aria-label="Filter documents"
              />
            </div>
            <div className="doc-category-pills">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`doc-pill ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                  {cat !== 'All' && (
                    <span className="pill-count">
                      {documents.filter((d) => d.category === cat).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <span className="doc-result-count">{filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}</span>
          </div>

          {/* ── Document grid ── */}
          <div className="doc-grid">
            {/* The grid is what is loading, so the placeholder is a grid. The
                spinner it replaced sat in a single collapsed cell, so the panel
                changed height twice: once to show it, once to show the real
                documents. */}
            {loading ? (
              <SkeletonCardGrid count={6} minWidth={220} lines={2} />
            ) : loadError ? (
              <div className="doc-empty error">
                <IconAlertCircle />
                <p>Could not load your documents</p>
                <span>{loadError}</span>
                <button className="doc-upload-btn" onClick={loadDocuments}>Retry</button>
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="doc-empty">
                <IconFile />
                <p>{documents.length === 0 ? 'No documents uploaded yet' : 'No documents found'}</p>
                <span>
                  {documents.length === 0
                    ? 'Use the Upload button to add your first document'
                    : 'Try a different search or category'}
                </span>
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <div className="doc-card" key={doc.id}>
                  <div className="doc-card-top">
                    <div className="doc-type-icon" style={{ color: doc.color }}>
                      {typeIcon(doc.type)}
                    </div>
                    <div className="doc-card-info">
                      <span className="doc-card-name">{doc.name}</span>
                      <span className="doc-card-code">{doc.code}</span>
                    </div>
                    <button className="doc-more-btn" aria-label="More options"><IconMore /></button>
                  </div>

                  <div className="doc-card-meta">
                    {/* No "Size" field: student_documents does not record file size. */}
                    <span className="doc-meta-item">
                      <span className="meta-label">Category</span>
                      <span className="meta-value">{doc.category}</span>
                    </span>
                    <span className="doc-meta-item">
                      <span className="meta-label">Uploaded</span>
                      <span className="meta-value">{doc.uploaded}</span>
                    </span>
                    <span className={`doc-status-pill ${statusClass(doc.status)}`}>
                      {doc.status}
                    </span>
                  </div>

                  <div className="doc-card-actions">
                    <button className="doc-action-btn" aria-label="Download" onClick={() => handleDownload(doc)}>
                      <IconDownload />
                      <span>Download</span>
                    </button>
                    <button className="doc-action-btn" aria-label="Preview" onClick={() => setPreviewDoc(doc)}>
                      <IconEye />
                      <span>Preview</span>
                    </button>
                    <button className="doc-action-btn danger" aria-label="Delete" onClick={() => setDeleteDoc(doc)}>
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Bottom: sidebar-like recent uploads ── */}
          <div className="doc-bottom-row">
            <div className="doc-recent-card">
              <div className="doc-recent-header">
                <span className="card-title">Recent Uploads</span>
                <button className="doc-view-all">View All <IconChevronRight /></button>
              </div>
              <div className="doc-recent-list">
                {loading && (
                  <div className="aims-stagger" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0' }}>
                        <Skeleton variant="card" w={30} h={30} radius="8px" />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <Skeleton variant="text" w={`${55 + i * 12}%`} />
                          <Skeleton variant="text" w="34%" h={8} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!loading && recentUploads.length === 0 && (
                  <span className="recent-empty">No uploads yet</span>
                )}
                {recentUploads.map((doc) => (
                  <div className="doc-recent-item" key={doc.id}>
                    <span className="recent-icon" style={{ color: doc.color }}>
                      {typeIcon(doc.type)}
                    </span>
                    <div className="recent-info">
                      <span className="recent-name">{doc.name}</span>
                      {/* No file size here either — the table does not store one. */}
                      <span className="recent-meta">{doc.uploaded} · {doc.category}</span>
                    </div>
                    <span className={`recent-status ${statusClass(doc.status)}`}>
                      {doc.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="doc-tips-card">
              <span className="card-title">Quick Tips</span>
              <ul className="doc-tips-list">
                <li>Upload scanned copies of your ID cards and certificates.</li>
                <li>Verified documents are marked with a green badge.</li>
                <li>Download your semester marksheets for future reference.</li>
                <li>Keep your scholarship forms updated every semester.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ── Upload Modal ── */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUpload}
        />
      )}

      {/* ── Preview Modal ── */}
      {previewDoc && (
        <PreviewModal
          doc={previewDoc}
          profile={profile}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteDoc && (
        <DeleteConfirmModal
          doc={deleteDoc}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteDoc(null)}
        />
      )}
    </div>
  );
};

export default Document;
