import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, Clock, Printer, Building2, Mail } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { BRANDING } from '../config/branding';
import { useSupportEmail } from '../hooks/useSupportEmail';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export const ContactPage: React.FC = () => {
  const supportEmail = useSupportEmail();
  const mapsEmbedUrl = `https://www.google.com/maps/embed/v1/place?key=${MAPS_API_KEY}&q=${BRANDING.address.mapsQuery}&zoom=15`;
  const mapsLinkUrl = `https://www.google.com/maps/search/?api=1&query=${BRANDING.address.mapsQuery}`;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/dashboard"
        className="inline-flex items-center text-primary-600 hover:text-primary-700 text-sm font-medium"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-secondary-900">Contact Us</h1>
        <p className="text-secondary-600 mt-2">
          Get in touch with {BRANDING.practiceName}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Details */}
        <div className="space-y-6">
          {/* Business Name */}
          <Card className="p-6">
            <div className="flex items-start space-x-4">
              <div className="bg-primary-100 p-3 rounded-lg">
                <Building2 className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-secondary-900">{BRANDING.practiceName}</h2>
                <p className="text-secondary-600 text-sm mt-1">Healthcare services</p>
              </div>
            </div>
          </Card>

          {/* Address */}
          <Card className="p-6">
            <div className="flex items-start space-x-4">
              <div className="bg-primary-100 p-3 rounded-lg">
                <MapPin className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold text-secondary-900">Address</h3>
                <p className="text-secondary-600 mt-1">{BRANDING.address.street}</p>
                <p className="text-secondary-600">
                  {BRANDING.address.city}, {BRANDING.address.state} {BRANDING.address.zip}
                </p>
                <a
                  href={mapsLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-700 text-sm font-medium mt-2 inline-block"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </Card>

          {/* Contact Methods */}
          <Card className="p-6 space-y-5">
            {BRANDING.supportPhone && (
              <div className="flex items-start space-x-4">
                <div className="bg-primary-100 p-3 rounded-lg">
                  <Phone className="h-6 w-6 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-secondary-900">Phone</h3>
                  <a
                    href={`tel:${BRANDING.supportPhone}`}
                    className="text-primary-600 hover:text-primary-700 mt-1 inline-block"
                  >
                    {BRANDING.supportPhone}
                  </a>
                </div>
              </div>
            )}

            {supportEmail && (
              <div className="flex items-start space-x-4">
                <div className="bg-primary-100 p-3 rounded-lg">
                  <Mail className="h-6 w-6 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-secondary-900">Email</h3>
                  <a
                    href={`mailto:${supportEmail}`}
                    className="text-primary-600 hover:text-primary-700 mt-1 inline-block"
                  >
                    {supportEmail}
                  </a>
                </div>
              </div>
            )}

            {BRANDING.fax && (
              <div className="flex items-start space-x-4">
                <div className="bg-primary-100 p-3 rounded-lg">
                  <Printer className="h-6 w-6 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-secondary-900">Fax</h3>
                  <p className="text-secondary-600 mt-1">{BRANDING.fax}</p>
                </div>
              </div>
            )}
          </Card>

          {/* Hours */}
          <Card className="p-6">
            <div className="flex items-start space-x-4">
              <div className="bg-primary-100 p-3 rounded-lg">
                <Clock className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold text-secondary-900">Office Hours</h3>
                <div className="mt-2 space-y-1">
                  {BRANDING.hours.map((h) => (
                    <div key={h.day} className="flex justify-between text-sm gap-6">
                      <span className="text-secondary-600">{h.day}</span>
                      <span className="text-secondary-900 font-medium">{h.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Map */}
        <div>
          <Card className="overflow-hidden h-full" padding={false}>
            <div className="aspect-[4/3] lg:aspect-auto lg:h-full">
              {MAPS_API_KEY ? (
                <iframe
                  title="Office Location"
                  src={mapsEmbedUrl}
                  className="w-full h-full border-0"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary-100">
                  <div className="text-center">
                    <MapPin className="h-12 w-12 text-secondary-400 mx-auto mb-3" />
                    <p className="text-secondary-600 font-medium">{BRANDING.address.full}</p>
                    <a
                      href={mapsLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700 text-sm font-medium mt-2 inline-block"
                    >
                      View on Google Maps
                    </a>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
