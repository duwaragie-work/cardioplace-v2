'use client';

import { X, Phone, Video, Clock, Calendar, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Alert {
  id: string;
  initials: string;
  name: string;
  location: string;
  reading: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM';
  level: 'L1' | 'L2';
  color: 'red' | 'amber';
  patientId: string;
  followUpScheduledAt: string | null;
}

interface ScheduleModalProps {
  alert: Alert;
  onClose: () => void;
  onConfirm: (details: ScheduleDetails) => void;
  error?: string | null;
}

export interface ScheduleDetails {
  patientName: string;
  date: string;
  time: string;
  callType: 'phone' | 'video';
  notes: string;
}

const getNextDays = () => {
  const days: { label: string; sublabel: string; value: string }[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()],
      sublabel: `${monthNames[d.getMonth()]} ${d.getDate()}`,
      value: `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    });
  }
  return days;
};

const timeSlots = [
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM',
];

export default function ScheduleModal({
  alert,
  onClose,
  onConfirm,
  error,
}: ScheduleModalProps) {
  const days = getNextDays();
  const [selectedDate, setSelectedDate] = useState(days[1].value);
  const [selectedTime, setSelectedTime] = useState('10:00 AM');
  const [callType, setCallType] = useState<'phone' | 'video'>('phone');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    setConfirmed(true);
    onConfirm({
      patientName: alert.name,
      date: selectedDate,
      time: selectedTime,
      callType,
      notes,
    });
  };

  // If there's an error, reset the confirmed state so user can retry
  if (error && confirmed) {
    setConfirmed(false);
    setSubmitting(false);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-60 flex items-center justify-center px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        <motion.div
          className="relative bg-white rounded-2xl w-full max-w-120 max-h-[90vh] overflow-y-auto z-10"
          style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }}
          initial={{ opacity: 0, scale: 0.93, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
        >
          {confirmed && !error ? (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 20,
                  delay: 0.1,
                }}
              >
                <CheckCircle2
                  className="w-16 h-16 mb-4"
                  style={{ color: 'var(--brand-success-green)' }}
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h3
                  className="text-xl font-bold mb-2"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  Follow-up Scheduled!
                </h3>
                <p
                  className="text-sm"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Call scheduled. Patient notified in-app.
                  <br />
                  {callType === 'phone' ? 'Phone call' : 'Video call'} with{' '}
                  {alert.name}
                  <br />
                  {selectedDate} at {selectedTime}
                </p>
              </motion.div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 py-5"
                style={{ borderBottom: '1px solid var(--brand-border)' }}
              >
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Calendar
                      className="w-4 h-4"
                      style={{ color: 'var(--brand-primary-purple)' }}
                    />
                    <h2
                      className="text-base font-semibold"
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      Schedule Follow-up Call
                    </h2>
                  </div>
                  <p
                    className="text-[13px]"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    Patient:{' '}
                    <span
                      className="font-semibold"
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      {alert.name}
                    </span>
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl hover:bg-gray-100 transition"
                >
                  <X
                    className="w-5 h-5"
                    style={{ color: 'var(--brand-text-muted)' }}
                  />
                </button>
              </div>

              <div className="px-6 py-5 space-y-6">
                {/* Error message */}
                {error && (
                  <div
                    className="rounded-xl p-3 text-sm font-medium"
                    style={{
                      backgroundColor: 'var(--brand-alert-red-light)',
                      color: 'var(--brand-alert-red)',
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* Call Type */}
                <div>
                  <p
                    className="text-[13px] font-semibold mb-3"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Call Type
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { value: 'phone' as const, label: 'Phone Call', icon: Phone },
                        { value: 'video' as const, label: 'Video Call', icon: Video },
                      ] as const
                    ).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setCallType(value)}
                        className="flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all"
                        style={{
                          borderColor:
                            callType === value
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-border)',
                          backgroundColor:
                            callType === value
                              ? 'var(--brand-primary-purple-light)'
                              : 'white',
                          color:
                            callType === value
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-text-secondary)',
                        }}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-sm font-semibold">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Selection */}
                <div>
                  <p
                    className="text-[13px] font-semibold mb-3"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Select Date
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {days.map((day) => (
                      <button
                        key={day.value}
                        onClick={() => setSelectedDate(day.value)}
                        className="shrink-0 flex flex-col items-center px-3 py-2.5 rounded-xl border-2 transition-all min-w-16"
                        style={{
                          borderColor:
                            selectedDate === day.value
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-border)',
                          backgroundColor:
                            selectedDate === day.value
                              ? 'var(--brand-primary-purple-light)'
                              : 'white',
                          color:
                            selectedDate === day.value
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-text-secondary)',
                        }}
                      >
                        <span className="text-[11px] font-semibold">
                          {day.label}
                        </span>
                        <span className="text-[10px] mt-0.5 opacity-70">
                          {day.sublabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Slots */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock
                      className="w-4 h-4"
                      style={{ color: 'var(--brand-text-muted)' }}
                    />
                    <p
                      className="text-[13px] font-semibold"
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      Select Time
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {timeSlots.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => setSelectedTime(slot)}
                        className="py-2 px-3 rounded-xl border-2 text-xs font-semibold transition-all"
                        style={{
                          borderColor:
                            selectedTime === slot
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-border)',
                          backgroundColor:
                            selectedTime === slot
                              ? 'var(--brand-primary-purple-light)'
                              : 'white',
                          color:
                            selectedTime === slot
                              ? 'var(--brand-primary-purple)'
                              : 'var(--brand-text-secondary)',
                        }}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <p
                    className="text-[13px] font-semibold mb-2"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Notes{' '}
                    <span
                      className="font-normal"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      (optional)
                    </span>
                  </p>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g. Discuss medication adherence, BP readings..."
                    className="w-full rounded-xl px-4 py-3 text-[13px] resize-none outline-none transition"
                    style={{
                      border: '2px solid var(--brand-border)',
                      color: 'var(--brand-text-primary)',
                      backgroundColor: 'var(--brand-background)',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor =
                        'var(--brand-primary-purple)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--brand-border)';
                    }}
                  />
                </div>
              </div>

              {/* Footer Buttons */}
              <div
                className="px-6 py-4 flex gap-3"
                style={{ borderTop: '1px solid var(--brand-border)' }}
              >
                <button
                  onClick={onClose}
                  className="flex-1 h-11 rounded-full border-2 text-sm font-bold transition hover:bg-gray-50"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-secondary)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="flex-2 h-11 rounded-full text-white text-sm font-bold transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                  style={{
                    backgroundColor: 'var(--brand-primary-purple)',
                    boxShadow: 'var(--brand-shadow-button)',
                  }}
                >
                  {submitting ? 'Scheduling...' : 'Confirm Schedule'}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
