"""Every work cited in the manuscript or considered during the literature review.

Format: (bibtex key, short citation, DOI or None, arXiv id or None)

Keys match refs.bib where an entry already exists, so the downloaded PDF in
references/<key>.pdf sits beside the citation that uses it.
"""

WORKS = [
    # ── already in refs.bib ────────────────────────────────────────────────
    ("beven1979", "Beven & Kirkby 1979, variable contributing area model",
     "10.1080/02626667909491834", None),
    ("ocallaghan1984", "O'Callaghan & Mark 1984, drainage networks from DEM",
     "10.1016/S0734-189X(84)80011-0", None),
    ("barnes2014", "Barnes, Lehman & Mulla 2014, priority-flood depression filling",
     "10.1016/j.cageo.2013.04.024", None),
    ("renno2008", "Renno et al. 2008, HAND terrain descriptor",
     "10.1016/j.rse.2008.03.018", None),
    ("nobre2011", "Nobre et al. 2011, Height Above Nearest Drainage",
     "10.1016/j.jhydrol.2011.03.051", None),
    ("kelleher2020", "Kelleher & McPhillips 2020, topographic indices for urban pluvial",
     "10.1002/hyp.13628", None),
    ("tehrany2014", "Tehrany, Pradhan & Jebur 2014, weights-of-evidence + SVM",
     "10.1016/j.jhydrol.2014.03.008", None),
    ("chen2016xgboost", "Chen & Guestrin 2016, XGBoost",
     "10.1145/2939672.2939785", "1603.02754"),
    ("agonafir2022understanding", "Agonafir et al. 2022, NYC 311 street flooding",
     "10.1016/j.jhydrol.2021.127300", None),
    ("agonafir2022ml", "Agonafir et al. 2022, ML on spatial variability of NYC 311",
     "10.1016/j.compenvurbsys.2022.101854", None),
    ("roberts2017", "Roberts et al. 2017, CV for spatially structured data",
     "10.1111/ecog.02881", None),
    ("ploton2020", "Ploton et al. 2020, spatial validation of mapping models",
     "10.1038/s41467-020-18321-y", None),
    ("youssef2016", "Youssef, Pradhan & Sefry 2016, Jeddah flash-flood susceptibility",
     "10.1007/s12665-015-4830-8", None),
    ("dano2019", "Dano et al. 2019, GIS-ANP flood susceptibility, Perlis",
     "10.3390/w11030615", None),
    ("almazroui2020", "Almazroui 2020, Saudi temperature trends and extremes",
     "10.1155/2020/8828421", None),
    ("phillips2009", "Phillips et al. 2009, sample selection bias in presence-only models",
     "10.1890/07-2153.1", None),
    ("barbetmassin2012", "Barbet-Massin et al. 2012, selecting pseudo-absences",
     "10.1111/j.2041-210X.2011.00172.x", None),
    ("davis2006", "Davis & Goadrich 2006, relationship between PR and ROC curves",
     "10.1145/1143844.1143874", None),
    ("saito2015", "Saito & Rehmsmeier 2015, PR plot more informative than ROC",
     "10.1371/journal.pone.0118432", None),
    ("arnold1996", "Arnold & Gibbons 1996, impervious surface coverage",
     "10.1080/01944369608975688", None),
    ("hawker2022fabdem", "Hawker et al. 2022, FABDEM bare-earth DEM",
     "10.1088/1748-9326/ac4d4f", None),
    ("krieger2007tandemx", "Krieger et al. 2007, TanDEM-X SAR interferometry",
     "10.1109/TGRS.2007.900693", None),

    # ── model benchmarks and comparisons ──────────────────────────────────
    ("seleem2022", "Seleem et al. 2022, urban flood susceptibility in Berlin "
     "(CNN/ANN/RF/SVM at four resolutions)",
     "10.1080/19475705.2022.2097131", None),
    ("bersabe2025", "Bersabe & Jun 2025, Seoul pluvial flood susceptibility with "
     "drainage data", "10.3390/ijgi14020057", None),
    ("dey2024", "Dey et al. 2024, frequency ratio vs decision-tree ensembles, "
     "New Orleans", "10.1007/s11069-024-06609-x", None),
    ("salau2026", "Salau & Quiring 2026, urban pluvial flooding in Cincinnati",
     "10.3390/ijgi15040173", None),
    ("han2024", "Han et al. 2024, urban waterlogging model comparison, Beijing "
     "(reports RF and SVM-RBF overfitting)",
     "10.1016/j.jenvman.2024.121166", None),
    ("zhangguo2026", "Zhang & Guo 2026, interpretable ML with spatial heterogeneity, "
     "Yancheng", "10.1038/s41598-026-47925-5", None),
    ("ajin2025", "Ajin et al. 2025, ensemble boosting; one of the very few papers "
     "reporting average precision", "10.3390/w17142041", None),
    ("ren2024", "Ren et al. 2024, random sampling strategy in RF/XGBoost ensembles",
     "10.3390/rs16020320", None),
    ("darabi2019", "Darabi et al. 2019, GARP and QUEST for urban flood risk",
     "10.1016/j.jhydrol.2018.12.002", None),
    ("norallahi2021", "Norallahi & Seyed Kaboli 2021, GARP, RF, MaxEnt, Naive Bayes",
     "10.1007/s11069-020-04453-3", None),

    # ── 311 / crowdsourced complaint data ─────────────────────────────────
    ("lerma2025", "Lerma, Goodall & Quinn 2025, environmental and socioeconomic "
     "drivers of urban flood reports, Norfolk VA", "10.3390/w17213178", None),
    ("lee2025chicago", "Lee et al. 2025, urban flooding in Chicago from crowdsourced "
     "data", "10.1088/2634-4505/add4eb", None),
    ("agostini2024", "Agostini, Pierson & Garg 2024, Bayesian spatial correction of "
     "under-reporting in NYC flooding 311", "10.1609/aaai.v38i20.30190", "2312.11754"),
    ("yuan2023road", "Yuan et al. 2023, road flooding risk from crowdsourced reports "
     "and traffic data", "10.1007/s43762-023-00082-1", None),

    # ── graph models ──────────────────────────────────────────────────────
    ("yuan2022stgcn", "Yuan et al. 2022, spatio-temporal GCN for road-network "
     "inundation status", "10.1016/j.compenvurbsys.2022.101870", None),
    ("wang2023gat", "Wang, Lyu & Zhang 2023, graph attention network for pluvial "
     "susceptibility in data-scarce areas", "10.1080/10106049.2023.2275692", None),
    ("vemula2025", "Vemula, Gatti & Jehel 2025, graph transformer flood susceptibility "
     "(XGBoost still won on AUC)", None, "2504.03727"),

    # ── presence-only, PU learning, negative sampling ──────────────────────
    ("li2022pu", "Li et al. 2022, positive-unlabeled learning for urban flood "
     "susceptibility (PBLC), Guangzhou", "10.3390/land11111971", None),
    ("zhang2025sampling", "Zhang et al. 2025, data uncertainty from non-flood sample "
     "selection (+24% accuracy from sampling alone)", "10.3390/rs17030375", None),
    ("wu2020baggingpu", "Wu et al. 2020, bagging-based PU learning for landslide "
     "susceptibility", "10.1109/JSTARS.2020.2989497", None),
    ("lobo2008", "Lobo, Jimenez-Valverde & Real 2008, AUC is a misleading measure "
     "for presence-only models", "10.1111/j.1466-8238.2007.00358.x", None),
    ("vakhshoori2018", "Vakhshoori & Zare 2018, is ROC reliable for susceptibility "
     "maps", "10.1080/19475705.2018.1424043", None),

    # ── modern tabular models ─────────────────────────────────────────────
    ("deng2026tabpfn", "Deng, Li & Wang 2026, TabPFN on geospatial tabular data",
     "10.1080/13658816.2026.2691066", None),
    ("huang2026tabpfnflood", "Huang et al. 2026, TabPFN for flood depth regression, "
     "Houston", None, "2606.05265"),
]
