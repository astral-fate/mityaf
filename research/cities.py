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
#   San Francisco — no street-flooding category; only building-level
#                   "Light_Wells_Dirty_Flooded" and free-text subtype soup.
#   Baltimore     — Socrata resource did not respond.
