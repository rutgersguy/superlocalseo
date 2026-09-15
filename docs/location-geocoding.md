# Address coordinates for new locations

Every location creation and address edit invokes address lookup automatically. The entered business address remains unchanged, including suite details. Normalization is used only when searching for coordinates.

The lookup first tries the original address, a structured address, and a normalized structured street without the unit/suite. It handles an ordinal street written as `E81 St` by searching `E 81st St`. Nominatim requests are serialized at no more than one request per second per API process. Each request has an eight-second timeout; a service error stops further Nominatim attempts.

If those requests do not yield verified coordinates and the existing Places API key is configured, one Google Places Text Search searches the normalized address. Only a single address/premise result is considered. One Place Details request then obtains address components and geometry. This uses the existing Places API, not the separately authorized Google Geocoding API. See Google's [Place Details documentation](https://developers.google.com/maps/documentation/places/web-service/legacy/details).

Both paths require the street number, street name, city, state, country and supplied ZIP to match. A city centroid, a road without a street number, multiple possible results, a different ZIP, and malformed coordinates are not accepted. The address Place ID is never stored as the business's Google Place ID. Address geometry locates the property; it does not verify a business identity or suite entrance.

Coordinates are saved only if the location still has the address that was searched. A slow response for an old address cannot overwrite a later edit. Initial map scans automatically proceed after usable coordinates are saved.

Settings → Locations displays retry guidance when coordinates are unresolved and refreshes the displayed coordinate state automatically. Check the street number/name, city and ZIP, then edit and save the location to retry. A failed lookup is not replaced with a guessed center. Existing historical locations are not rescanned in bulk.
