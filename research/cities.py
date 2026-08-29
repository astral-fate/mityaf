"""City configurations for multi-city flood-susceptibility training.

Adding a city requires three things and nothing else: a bounding box, an open
complaint feed with a descriptor that means "water standing on a street", and
the Copernicus DEM tiles covering it. Terrain and road features come from
global sources, so a new city needs no new feature code — which is the same
property that lets any of this reach Al Madinah.

The point of a second city is not more rows. It is that leave-one-city-out
evaluation tests the claim we actually make: that the model FORM transfers to
a city it was never fitted on. Spatial blocking within one city cannot test
that, because the drainage design, the climate and the reporting culture are
held constant.
"""

CITIES = {
    "nyc": {
        "name": "New York City",
        "bbox": (-74.05, 40.54, -73.70, 40.92),
        "dem_tiles": [
            "Copernicus_DSM_COG_10_N40_00_W074_00_DEM",
            "Copernicus_DSM_COG_10_N40_00_W075_00_DEM",
        ],
        # NYC calls it "Street Flooding (SJ)" — the city defines the descriptor
        # as "flooding or ponding on a street".
        "labels_url": (
            "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
            "?$select=created_date,descriptor,latitude,longitude"
            "&$where=descriptor='Street Flooding (SJ)' AND latitude IS NOT NULL"
            "&$limit=50000"
        ),
        "expected_labels": 21_287,
    },
    "chicago": {
        "name": "Chicago",
        "bbox": (-87.95, 41.62, -87.50, 42.05),
        "dem_tiles": [
            "Copernicus_DSM_COG_10_N41_00_W088_00_DEM",
            "Copernicus_DSM_COG_10_N42_00_W088_00_DEM",
        ],
        # Chicago's equivalent descriptor. Same phenomenon, different words —
        # which is itself a reason to keep the mapping explicit per city rather
        # than pattern-matching on the string "flood".
        "labels_url": (
            "https://data.cityofchicago.org/resource/v6vf-nfxy.json"
            "?$select=created_date,sr_type,latitude,longitude"
            "&$where=sr_type='Water On Street Complaint' AND latitude IS NOT NULL"
            "&$limit=90000"
        ),
        "expected_labels": 80_469,
    },
    "sf": {
        "name": "San Francisco",
        "bbox": (-122.53, 37.69, -122.35, 37.84),
        "dem_tiles": [
            "Copernicus_DSM_COG_10_N37_00_W123_00_DEM",
            "Copernicus_DSM_COG_10_N37_00_W122_00_DEM",
        ],
        # San Francisco files flooding under "Sewer Issues", not under a street
        # category, so the subtype alone would mix water standing on a road with
        # water in somebody's basement. `service_details` is what separates them:
        # On_street (21,663) and its case variants against On_property (5,397).
        # Filtering on it is what makes this the same phenomenon as NYC's
        # "Street Flooding (SJ)" rather than a broader drainage complaint.
        #
        # The %25 are literal percent signs for SQL LIKE — build_city.py sends
        # this string to urllib, which would otherwise read a bare % as the
        # start of an escape sequence.
        "labels_url": (
            "https://data.sfgov.org/resource/vw6y-z8j6.json"
            "?$select=requested_datetime,service_details,lat as latitude,"
            "long as longitude"
            "&$where=lower(service_subtype)='flooding' AND lat IS NOT NULL AND ("
            "lower(service_details) like '%25street%25' OR "
            "lower(service_details) like '%25roadway%25' OR "
            "lower(service_details) like '%25parking_lane%25')"
            "&$limit=30000"
        ),
        "expected_labels": 25_774,
    },
    "dallas": {
        "name": "Dallas",
        "bbox": (-97.00, 32.62, -96.55, 33.02),
        "dem_tiles": [
            "Copernicus_DSM_COG_10_N32_00_W097_00_DEM",
            "Copernicus_DSM_COG_10_N33_00_W097_00_DEM",
        ],
        # Dallas splits the same phenomenon across two departments — Water
        # Utilities (DWU) and Public Works (PBW) — so the descriptor has to be
        # enumerated rather than pattern-matched. Deliberately excluded:
        # "Drainage Ditch Cleaning/Repairs", which is ditch maintenance, not
        # water standing on a street.
        #
        # Dallas publishes no latitude/longitude columns at all, only a single
        # location field serialised as the string "(lat,lon)" — build_city.py's
        # coords() parses it.
        "labels_url": (
            "https://www.dallasopendata.com/resource/d7e7-envw.json"
            "?$select=created_date,service_request_type,lat_location"
            "&$where=service_request_type in("
            "'Storm Drainage/Flooding Complaint - DWU',"
            "'Flooding - Emergency - PBW','Flooding - Past - PBW') "
            "AND lat_location IS NOT NULL"
            "&$limit=6000"
        ),
        "expected_labels": 3_468,
    },
    "madinah": {
        "name": "Al Madinah",
        "bbox": (39.50, 24.36, 39.72, 24.58),
        # A single 42 MB tile covers the whole study area.
        "dem_tiles": ["Copernicus_DSM_COG_10_N24_00_E039_00_DEM"],
        # No labels exist. That is the entire reason the other cities are here:
        # Madinah supplies the features, they supply the ground truth that
        # proves the features carry signal.
        "labels_url": None,
        "expected_labels": 0,
    },
}

# Candidates examined and rejected, recorded so nobody re-checks them:
#   Calgary       — 19,825 rows, but they are "Drainage Bylaw" and "Drainage
#                   Concerns": bylaw enforcement, not water standing on a road.
#                   Clean lat/lon, wrong phenomenon.
#   Austin        — 23,894 flood-ish rows, but overwhelmingly creek and drainage
#                   easement categories; the street subset is ~6,800 and the
#                   feed carries no coordinate column, only an address.
#   Kansas City   — no flooding category in the 311 feed.
#   Los Angeles   — publishes only aggregate call-centre tables, no incidents.
#   Gainesville   — 414 rows. Too small to move any estimate.
#   Baltimore     — Socrata resource did not respond.
#
# An earlier pass here rejected San Francisco for having "no street-flooding
# category". That was wrong: the category exists one level down, in
# service_details, and the city is now included above with 25,774 labels. The
# lesson is that a portal's top-level taxonomy is not always where the
# phenomenon lives.
