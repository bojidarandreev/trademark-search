'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';

interface TrademarkNoticeWrapper {
  TradeMark?: TrademarkDetailData;
}

interface TrademarkDetailData {
  ApplicationNumber?: string;
  RegistrationNumber?: string;
  MarkCurrentStatusCode?: string;
  ApplicationDate?: string;
  RegistrationDate?: string;
  ExpiryDate?: string;
  WordMarkSpecification?: {
    MarkVerbalElementText?: string;
  };
  ApplicantDetails?: {
    Applicant?: any | any[];
  };
  RepresentativeDetails?: {
    Representative?: any | any[];
  };
  GoodsServicesDetails?: {
    GoodsServices?: {
      ClassDescriptionDetails?: {
        ClassDescription?: any | any[];
      };
    };
  };
  MarkImageDetails?: {
    MarkImage?: {
      MarkImageFilename?: string;
    };
  };
  [key: string]: any;
}

function formatDateDisplay(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  let year, month, day;
  if (dateStr.includes('-')) {
    [year, month, day] = dateStr.split('-');
  } else if (dateStr.length === 8 && /^\d+$/.test(dateStr)) {
    year = dateStr.substring(0, 4);
    month = dateStr.substring(4, 6);
    day = dateStr.substring(6, 8);
  } else {
    return 'N/A (Unknown Format)';
  }
  if (!year || !month || !day || isNaN(parseInt(year)) || isNaN(parseInt(month)) || isNaN(parseInt(day))) {
    return 'N/A (Invalid Date Parts)';
  }
  return `${day}/${month}/${year}`;
}

async function fetchTrademarkNoticeDetails(id: string): Promise<TrademarkNoticeWrapper> {
  if (!id) throw new Error('Application ID is required to fetch notice details.');
  console.log(`Frontend Detail Page: Fetching /api/trademarks/notice/${id}`);
  const response = await fetch(`/api/trademarks/notice/${id}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Failed to parse error response" }));
    console.error('Frontend Detail Page: API call failed:', { status: response.status, data: errorData });
    throw new Error(errorData.details || errorData.error || `Failed to fetch trademark notice (status: ${response.status})`);
  }
  const data = await response.json();
  console.log("Frontend Detail Page: Raw notice data received from backend API (will be wrapped in {TradeMark: ...}):", data);
  return data; // Data is { TradeMark: { ...details... } }
}

const renderPartyDetails = (party: any, partyType: 'Applicant' | 'Representative') => {
  if (!party) return <p>N/A</p>;

  const addressBook = partyType === 'Applicant' ? party.ApplicantAddressBook : party.RepresentativeAddressBook;
  let displayName = '';
  let displayAddress = '';

  if (addressBook) {
    const nameAddr = addressBook.FormattedNameAddress;

    // Name Extraction
    if (nameAddr && nameAddr.Name) {
      if (nameAddr.Name.OrganizationName) {
        displayName = typeof nameAddr.Name.OrganizationName === 'string'
          ? nameAddr.Name.OrganizationName
          : nameAddr.Name.OrganizationName._text || '';
      } else if (nameAddr.Name.FormattedName) {
        const fn = nameAddr.Name.FormattedName;
        if (typeof fn === 'string') {
          displayName = fn;
        } else if (typeof fn === 'object' && fn !== null) {
          displayName = [fn.FirstName, fn.LastName].filter(Boolean).join(' ').trim();
        }
      }
    }

    // Fallback to PostalAddress for name if structured name wasn't found or is empty
    // For Applicant, PostalAddress seems to be the primary source for name if FormattedNameAddress is empty
    if (!displayName && typeof addressBook.PostalAddress === 'string') {
        const postalLines = addressBook.PostalAddress.split('\n');
        if (postalLines.length > 0) displayName = postalLines[0].trim();
    }
    displayName = displayName || (partyType === 'Applicant' && party.ApplicantIdentifier ? `Applicant ID: ${party.ApplicantIdentifier}` : 'Name N/A');


    // Address Extraction
    if (nameAddr && nameAddr.Address && nameAddr.Address.FormattedAddress) {
      const addr = nameAddr.Address.FormattedAddress;
      const addressParts = [
        (Array.isArray(addr.AddressLine) ? addr.AddressLine.map((line: any) => (typeof line === 'string' ? line : line._text)).join(', ') : (typeof addr.AddressLine === 'string' ? addr.AddressLine : addr.AddressLine?._text)),
        addr.AddressCity,
        addr.AddressPostcode,
        addr.AddressCountryCode || addr.FormattedAddressCountryCode
      ].filter(Boolean);
      if (addressParts.length > 0) displayAddress = addressParts.join(', ');

    } else if (nameAddr && nameAddr.Address && nameAddr.Address.FreeFormatAddress && nameAddr.Address.FreeFormatAddress.FreeFormatAddressLine) {
        const ffLines = nameAddr.Address.FreeFormatAddress.FreeFormatAddressLine;
        displayAddress = (Array.isArray(ffLines) ? ffLines.map((line: any) => (typeof line === 'string' ? line : line._text)) : [typeof ffLines === 'string' ? ffLines : ffLines?._text]).filter(Boolean).join(', ');
    }

    // Fallback to PostalAddress for address if other methods failed
    if (!displayAddress && typeof addressBook.PostalAddress === 'string') {
        const postalLines = addressBook.PostalAddress.split('\n');
        if (postalLines.length > 1 && displayName === postalLines[0].trim()) {
            displayAddress = postalLines.slice(1).join('\n').trim(); // Keep multi-line for address part
        } else if (postalLines.length > 0) {
             displayAddress = postalLines.join('\n').trim(); // Use all lines if name was different
        }
    }
    displayAddress = displayAddress || 'Address N/A';
  } else { // Fallback if addressBook itself is missing
     if (partyType === 'Applicant' && party.ApplicantIdentifier) {
        displayName = `Applicant ID: ${party.ApplicantIdentifier}`;
     }
  }

  return <p className="whitespace-pre-line">{displayName}<br/><span className="text-xs text-gray-500">{displayAddress}</span></p>;
};

export default function TrademarkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : undefined;

  const { data: noticeWrapper, isLoading, error, refetch, isFetching } = useQuery<TrademarkNoticeWrapper, Error>({
    queryKey: ['trademarkNotice', id],
    queryFn: () => fetchTrademarkNoticeDetails(id as string),
    enabled: !!id,
    retry: 1,
  });

  if (!id) {
    return <div className="container mx-auto p-4 text-center text-red-500">Invalid trademark ID.</div>;
  }

  const noticeData = noticeWrapper?.TradeMark;

  const renderNiceClasses = (goodsServicesContainer?: any) => {
    if (!goodsServicesContainer?.ClassDescriptionDetails?.ClassDescription) {
      return <p>N/A</p>;
    }

    let classEntries = goodsServicesContainer.ClassDescriptionDetails.ClassDescription;
    if (!Array.isArray(classEntries)) classEntries = [classEntries];

    const classNumbers = classEntries
      .map((cd: any) => cd.ClassNumber)
      .filter((cn: any) => cn !== null && cn !== undefined && cn !== '');

    if (classNumbers.length === 0) {
      return <p>Classes: N/A</p>;
    }

    return <p>Classes: {classNumbers.join(', ')}</p>;
  };

  // Conditional rendering logic
  let content;
  if (isLoading || (isFetching && !noticeData)) {
    content = (
      <Card>
        <CardHeader><CardTitle><Skeleton className="h-8 w-3/4" /></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  } else if (error) {
    content = (
      <div className="text-red-500 text-center p-4 border rounded-md">
        <p className="font-semibold">Error loading trademark details</p>
        <p className="text-sm mt-2">{error.message}</p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()} disabled={isFetching}>
          Try Again
        </Button>
      </div>
    );
  } else if (noticeData) {
    // Test explicit access for Mark Name
    const markText = noticeData.WordMarkSpecification?.MarkVerbalElementText;
    console.log("Debug Mark Text:", markText, "Notice Data WM Spec:", noticeData.WordMarkSpecification);

    content = (
      <Card>
        <CardHeader>
          <CardTitle>Détails de la Marque : {markText ? markText : 'N/A (markText empty)'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {noticeData.MarkImageDetails?.MarkImage?.MarkImageFilename && id && (
            <div className="my-4 text-center">
              <img
                src={`/api/trademark-image/${id}`}
                alt={`Logo for ${noticeData.WordMarkSpecification?.MarkVerbalElementText || 'trademark'}`}
                className="inline-block border max-h-40"
              />
            </div>
          )}
          <div><h3 className="font-semibold">N° Demande/Enregistrement:</h3> <p>{noticeData.ApplicationNumber || 'N/A'} {noticeData.RegistrationNumber && noticeData.RegistrationNumber !== noticeData.ApplicationNumber ? `(N° Enr.: ${noticeData.RegistrationNumber})` : ''}</p></div>
          <div><h3 className="font-semibold">Statut Actuel:</h3> <p>{noticeData.MarkCurrentStatusCode || 'N/A'}</p></div>
          <div><h3 className="font-semibold">Date de Dépôt:</h3> <p>{formatDateDisplay(noticeData.ApplicationDate)}</p></div>
          <div><h3 className="font-semibold">Date d'Enregistrement:</h3> <p>{formatDateDisplay(noticeData.RegistrationDate)}</p></div>
          <div><h3 className="font-semibold">Date d'Expiration:</h3> <p>{formatDateDisplay(noticeData.ExpiryDate)}</p></div>

          <div>
            <h3 className="font-semibold mb-1">Déposant(s):</h3>
            {noticeData.ApplicantDetails?.Applicant ?
              (Array.isArray(noticeData.ApplicantDetails.Applicant) ?
                noticeData.ApplicantDetails.Applicant.map((app: any, i: number) => <div key={`app-${i}`} className="ml-4 mb-2">{renderPartyDetails(app, 'Applicant')}</div>) :
                <div className="ml-4">{renderPartyDetails(noticeData.ApplicantDetails.Applicant, 'Applicant')}</div>
              ) : <p className="ml-4">N/A</p>
            }
          </div>

          {noticeData.RepresentativeDetails?.Representative && (
               <div>
                  <h3 className="font-semibold mb-1">Mandataire(s):</h3>
                  {Array.isArray(noticeData.RepresentativeDetails.Representative) ?
                  noticeData.RepresentativeDetails.Representative.map((rep: any, i: number) => <div key={`rep-${i}`} className="ml-4 mb-2">{renderPartyDetails(rep, 'Representative')}</div>) :
                  <div className="ml-4">{renderPartyDetails(noticeData.RepresentativeDetails.Representative, 'Representative')}</div>
                  }
              </div>
          )}

          <div>
            <h3 className="font-semibold mb-1">Produits et services (Classification de Nice):</h3>
            <div className="text-sm ml-4">{renderNiceClasses(noticeData.GoodsServicesDetails?.GoodsServices)}</div>
          </div>

          <pre className="text-xs whitespace-pre-wrap bg-gray-100 p-2 rounded mt-4">
            {JSON.stringify(noticeData, null, 2)}
          </pre>
        </CardContent>
      </Card>
    );
  } else {
    content = (
      <div className="text-center p-4 text-gray-500">No details available for this trademark or data is not in the expected format.</div>
    );
  }

  return (
    <main className="container mx-auto p-4 max-w-4xl">
      <Button variant="outline" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Search Results
      </Button>
      {content}
    </main>
  );
}
