/* =============================================================================
   AFN FHA Risk Monitor — Initial Schema
   -----------------------------------------------------------------------------
   Target:   Azure SQL Database / SQL Server 2019+
   Schema:   fha   (dedicated schema for FHA Risk Monitor)
   Purpose:  Monthly RPA snapshots of combined HUD Neighborhood Watch + Encompass
             data, with historical time-travel support for the dashboard.

   Design summary (see workspace change log for full rationale):
     - `snapshots` anchors every monthly RPA run; every fact table carries snapshot_id
     - Compare Ratio data from HUD NW lives in 4 grain-specific tables
       (total / hoc / hud_office / branch)
     - `portfolio_slices` is a flattened unified table covering every
       dimensional General Analysis slice (DPA, FICO, DTI, LTV, etc.)
     - `loan_officer_performance` captures per-LO risk-factor fingerprint
     - `risk_indicator_distribution` stores the 0–13 indicator histogram
     - `loans` is the pre-marriaged loan-level drilldown grain
       (RPA joins Encompass + HUD NW Data 2 before writing)
     - `dimensions` + `hud_offices` are reference/metadata tables

   Conventions:
     - SQL Server syntax (T-SQL)
     - All fact tables: snapshot_id INT NOT NULL, FK to fha.snapshots
     - Decimals use (9,4) for percentages/ratios to preserve RPA precision
     - Retention: snapshots live forever (regulatory-adjacent)
     - Indexes: snapshot_id is leftmost in every clustered PK or index for
       efficient "show me this snapshot" queries
   =============================================================================*/


/* -----------------------------------------------------------------------------
   SCHEMA
   -----------------------------------------------------------------------------*/
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'fha')
    EXEC('CREATE SCHEMA fha AUTHORIZATION dbo;');
GO


/* -----------------------------------------------------------------------------
   1. snapshots — time anchor for every RPA run
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.snapshots', N'U') IS NOT NULL DROP TABLE fha.snapshots;
GO

CREATE TABLE fha.snapshots
(
    snapshot_id           INT              IDENTITY(1,1) NOT NULL,
    performance_period    DATE             NOT NULL,                  -- e.g. 2026-02-28 ("as of" date from HUD)
    rpa_run_id            VARCHAR(64)      NULL,                      -- RPA process run identifier
    ingested_at           DATETIME2(3)     NOT NULL CONSTRAINT DF_snapshots_ingested_at DEFAULT SYSUTCDATETIME(),
    ingested_by           VARCHAR(128)     NOT NULL CONSTRAINT DF_snapshots_ingested_by DEFAULT N'RPA-FHA-Monthly',
    source_file           NVARCHAR(512)    NULL,
    status                VARCHAR(16)      NOT NULL CONSTRAINT DF_snapshots_status DEFAULT N'processing',
    notes                 NVARCHAR(MAX)    NULL,
    CONSTRAINT PK_snapshots PRIMARY KEY CLUSTERED (snapshot_id),
    CONSTRAINT CK_snapshots_status CHECK (status IN (N'processing', N'complete', N'failed'))
);
GO

-- One completed snapshot per performance_period (RPA reruns should replace, not duplicate)
CREATE UNIQUE INDEX UX_snapshots_period_complete
    ON fha.snapshots (performance_period)
    WHERE status = N'complete';
GO


/* -----------------------------------------------------------------------------
   2. hud_offices — static reference (HUD Office → HOC mapping)
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.hud_offices', N'U') IS NOT NULL DROP TABLE fha.hud_offices;
GO

CREATE TABLE fha.hud_offices
(
    hud_office    VARCHAR(64)   NOT NULL,
    hoc           VARCHAR(32)   NOT NULL,    -- Atlanta | Denver | Philadelphia | Santa Ana
    state_code    CHAR(2)       NULL,
    region        VARCHAR(32)   NULL,
    is_active     BIT           NOT NULL CONSTRAINT DF_hud_offices_active DEFAULT 1,
    CONSTRAINT PK_hud_offices PRIMARY KEY CLUSTERED (hud_office),
    CONSTRAINT CK_hud_offices_hoc CHECK (hoc IN (N'Atlanta', N'Denver', N'Philadelphia', N'Santa Ana'))
);
GO


/* -----------------------------------------------------------------------------
   3. dimensions — UI metadata for portfolio_slices.dimension values
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.dimensions', N'U') IS NOT NULL DROP TABLE fha.dimensions;
GO

CREATE TABLE fha.dimensions
(
    dimension_key    VARCHAR(64)   NOT NULL,
    display_name     VARCHAR(128)  NOT NULL,
    display_order    INT           NOT NULL CONSTRAINT DF_dimensions_order DEFAULT 100,
    chart_type       VARCHAR(32)   NOT NULL CONSTRAINT DF_dimensions_chart DEFAULT N'bar',
    description      NVARCHAR(512) NULL,
    is_active        BIT           NOT NULL CONSTRAINT DF_dimensions_active DEFAULT 1,
    CONSTRAINT PK_dimensions PRIMARY KEY CLUSTERED (dimension_key),
    CONSTRAINT CK_dimensions_chart_type CHECK (chart_type IN (N'bar', N'stacked', N'heatmap', N'table', N'pie'))
);
GO


/* -----------------------------------------------------------------------------
   4. compare_ratios_total — AFN nationwide (Total / Retail / Sponsor)
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.compare_ratios_total', N'U') IS NOT NULL DROP TABLE fha.compare_ratios_total;
GO

CREATE TABLE fha.compare_ratios_total
(
    snapshot_id           INT            NOT NULL,
    scope                 VARCHAR(16)    NOT NULL,    -- 'total' | 'retail' | 'sponsor'
    compare_ratio         DECIMAL(9,4)   NULL,
    mix_adjusted_sdq      DECIMAL(9,4)   NULL,
    fha_benchmark_sdq     DECIMAL(9,4)   NULL,
    supplemental_metric   DECIMAL(9,4)   NULL,
    loans_count           INT            NULL,
    delinquent_count      INT            NULL,
    CONSTRAINT PK_compare_ratios_total PRIMARY KEY CLUSTERED (snapshot_id, scope),
    CONSTRAINT FK_compare_ratios_total_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_compare_ratios_total_scope CHECK (scope IN (N'total', N'retail', N'sponsor'))
);
GO


/* -----------------------------------------------------------------------------
   5. compare_ratios_hoc — 4 HUD regional Homeownership Centers
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.compare_ratios_hoc', N'U') IS NOT NULL DROP TABLE fha.compare_ratios_hoc;
GO

CREATE TABLE fha.compare_ratios_hoc
(
    snapshot_id           INT            NOT NULL,
    hoc_name              VARCHAR(32)    NOT NULL,    -- Atlanta | Denver | Philadelphia | Santa Ana
    compare_ratio         DECIMAL(9,4)   NULL,
    retail_ratio          DECIMAL(9,4)   NULL,
    sponsor_ratio         DECIMAL(9,4)   NULL,
    mix_adjusted_sdq      DECIMAL(9,4)   NULL,
    fha_benchmark_sdq     DECIMAL(9,4)   NULL,
    supplemental_metric   DECIMAL(9,4)   NULL,
    loans_count           INT            NULL,
    delinquent_count      INT            NULL,
    CONSTRAINT PK_compare_ratios_hoc PRIMARY KEY CLUSTERED (snapshot_id, hoc_name),
    CONSTRAINT FK_compare_ratios_hoc_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_compare_ratios_hoc_name CHECK (hoc_name IN (N'Atlanta', N'Denver', N'Philadelphia', N'Santa Ana'))
);
GO


/* -----------------------------------------------------------------------------
   6. compare_ratios_hud_office — per HUD Office (~77 rows/snapshot)
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.compare_ratios_hud_office', N'U') IS NOT NULL DROP TABLE fha.compare_ratios_hud_office;
GO

CREATE TABLE fha.compare_ratios_hud_office
(
    snapshot_id               INT            NOT NULL,
    hud_office                VARCHAR(64)    NOT NULL,
    retail_branches_count     INT            NULL,
    sponsored_branches_count  INT            NULL,
    compare_ratio             DECIMAL(9,4)   NULL,
    retail_ratio              DECIMAL(9,4)   NULL,
    sponsor_ratio             DECIMAL(9,4)   NULL,
    loans_count               INT            NULL,
    delinquent_count          INT            NULL,
    mix_adjusted_sdq          DECIMAL(9,4)   NULL,
    fha_benchmark_sdq         DECIMAL(9,4)   NULL,
    supplemental_metric       DECIMAL(9,4)   NULL,
    CONSTRAINT PK_compare_ratios_hud_office PRIMARY KEY CLUSTERED (snapshot_id, hud_office),
    CONSTRAINT FK_compare_ratios_hud_office_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE
    -- hud_office not FK'd to fha.hud_offices to tolerate new offices appearing
    -- in the HUD export before the reference table is updated.
);
GO

CREATE INDEX IX_compare_ratios_hud_office_snapshot_ratio
    ON fha.compare_ratios_hud_office (snapshot_id, compare_ratio DESC);
GO


/* -----------------------------------------------------------------------------
   7. compare_ratios_branch — NMLS-level branch detail
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.compare_ratios_branch', N'U') IS NOT NULL DROP TABLE fha.compare_ratios_branch;
GO

CREATE TABLE fha.compare_ratios_branch
(
    snapshot_id           INT            NOT NULL,
    nmls_id               VARCHAR(32)    NOT NULL,
    branch_name           NVARCHAR(256)  NULL,
    hud_office            VARCHAR(64)    NULL,
    approval_status       CHAR(1)        NULL,        -- 'A' = Approved | 'T' = Terminated
    loans_underwritten    INT            NULL,
    delinquency_rate      DECIMAL(9,4)   NULL,
    compare_ratio         DECIMAL(9,4)   NULL,
    CONSTRAINT PK_compare_ratios_branch PRIMARY KEY CLUSTERED (snapshot_id, nmls_id),
    CONSTRAINT FK_compare_ratios_branch_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_compare_ratios_branch_status CHECK (approval_status IN (N'A', N'T') OR approval_status IS NULL)
);
GO

CREATE INDEX IX_compare_ratios_branch_hud_office
    ON fha.compare_ratios_branch (snapshot_id, hud_office);
GO


/* -----------------------------------------------------------------------------
   8. portfolio_slices — flattened unified dimensional analysis
   -----------------------------------------------------------------------------
   One table to cover every RPA "General Analysis" slice.
   Dimensions include:
     dpa_type, fico, front_dti, back_dti, ltv, investor, hud_office,
     source_of_funds, employment, aus, loan_purpose, units, risk_indicator_count,
     dpa_program, dpa_investor, channel, ...
   Adding a new dimension requires ZERO schema change — just insert data.
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.portfolio_slices', N'U') IS NOT NULL DROP TABLE fha.portfolio_slices;
GO

CREATE TABLE fha.portfolio_slices
(
    snapshot_id                    INT            NOT NULL,
    dimension                      VARCHAR(64)    NOT NULL,
    bucket                         NVARCHAR(128)  NOT NULL,
    bucket_order                   INT            NOT NULL CONSTRAINT DF_portfolio_slices_order DEFAULT 0,

    -- Populations
    combined_population            INT            NULL,
    retail_population              INT            NULL,
    wholesale_population           INT            NULL,

    -- Delinquent counts
    combined_delinquent            INT            NULL,
    retail_delinquent              INT            NULL,
    wholesale_delinquent           INT            NULL,

    -- Delinquency percentages (pre-computed by RPA)
    combined_pct                   DECIMAL(9,4)   NULL,
    retail_pct                     DECIMAL(9,4)   NULL,
    wholesale_pct                  DECIMAL(9,4)   NULL,

    -- Baseline context (the "AFN baseline" row values from the RPA report)
    baseline_combined              DECIMAL(9,4)   NULL,
    baseline_retail                DECIMAL(9,4)   NULL,
    baseline_wholesale             DECIMAL(9,4)   NULL,

    -- Baseline comparisons (pct diff from baseline, pre-computed by RPA)
    baseline_comparison_combined   DECIMAL(9,4)   NULL,
    baseline_comparison_retail     DECIMAL(9,4)   NULL,
    baseline_comparison_wholesale  DECIMAL(9,4)   NULL,

    CONSTRAINT PK_portfolio_slices PRIMARY KEY CLUSTERED (snapshot_id, dimension, bucket),
    CONSTRAINT FK_portfolio_slices_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE
    -- No FK on dimension -> fha.dimensions so RPA can write new dimensions
    -- before the metadata row is created; UI can backfill display metadata.
);
GO

-- Retrieval pattern: "give me all buckets for dimension X in snapshot Y, sorted"
CREATE INDEX IX_portfolio_slices_dim_order
    ON fha.portfolio_slices (snapshot_id, dimension, bucket_order);
GO


/* -----------------------------------------------------------------------------
   9. loan_officer_performance — per-LO leaderboard with risk-factor panel
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.loan_officer_performance', N'U') IS NOT NULL DROP TABLE fha.loan_officer_performance;
GO

CREATE TABLE fha.loan_officer_performance
(
    snapshot_id                    INT            NOT NULL,
    lo_nmls_id                     VARCHAR(32)    NOT NULL,
    lo_name                        NVARCHAR(256)  NULL,
    approval_status                CHAR(1)        NULL,
    channel                        VARCHAR(16)    NULL,         -- Retail | Wholesale

    funded_count                   INT            NULL,
    delinquent_count               INT            NULL,
    delinquency_pct                DECIMAL(9,4)   NULL,
    baseline_comparison            DECIMAL(9,4)   NULL,

    -- Risk-factor counts (among this LO's delinquent loans)
    sub_620_count                  INT            NULL,
    super_29_dti_count             INT            NULL,
    super_50_dti_count             INT            NULL,
    super_90_ltv_count             INT            NULL,
    super_95_ltv_count             INT            NULL,
    dpa_count                      INT            NULL,
    manufactured_count             INT            NULL,
    variable_income_count          INT            NULL,
    super_variable_income_count    INT            NULL,
    non_owner_occupied_count       INT            NULL,
    manual_uw_count                INT            NULL,
    hud_deficiency_count           INT            NULL,
    gift_grant_count               INT            NULL,

    CONSTRAINT PK_loan_officer_performance PRIMARY KEY CLUSTERED (snapshot_id, lo_nmls_id),
    CONSTRAINT FK_loan_officer_performance_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_loan_officer_performance_status CHECK (approval_status IN (N'A', N'T') OR approval_status IS NULL),
    CONSTRAINT CK_loan_officer_performance_channel CHECK (channel IN (N'Retail', N'Wholesale') OR channel IS NULL)
);
GO

CREATE INDEX IX_loan_officer_performance_worst_offenders
    ON fha.loan_officer_performance (snapshot_id, delinquency_pct DESC);
GO


/* -----------------------------------------------------------------------------
   10. risk_indicator_distribution — 0..13 indicator histogram
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.risk_indicator_distribution', N'U') IS NOT NULL DROP TABLE fha.risk_indicator_distribution;
GO

CREATE TABLE fha.risk_indicator_distribution
(
    snapshot_id           INT            NOT NULL,
    indicator_count       TINYINT        NOT NULL,        -- 0..13
    loans_count           INT            NULL,
    delinquent_count      INT            NULL,
    delinquency_pct       DECIMAL(9,4)   NULL,
    baseline_comparison   DECIMAL(9,4)   NULL,
    CONSTRAINT PK_risk_indicator_distribution PRIMARY KEY CLUSTERED (snapshot_id, indicator_count),
    CONSTRAINT FK_risk_indicator_distribution_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_risk_indicator_distribution_range CHECK (indicator_count BETWEEN 0 AND 13)
);
GO


/* -----------------------------------------------------------------------------
   11. loans — pre-joined loan-level drilldown grain
   -----------------------------------------------------------------------------
   RPA marries Encompass + HUD NW Data 2 and writes the combined row here.
   This is the largest table; most analytics should read from the aggregate
   tables above and only hit `loans` for drilldowns.
   -----------------------------------------------------------------------------*/
IF OBJECT_ID(N'fha.loans', N'U') IS NOT NULL DROP TABLE fha.loans;
GO

CREATE TABLE fha.loans
(
    snapshot_id                 INT             NOT NULL,
    loan_id                     VARCHAR(64)     NOT NULL,      -- AFN / Encompass internal
    fha_case_number             VARCHAR(32)     NULL,          -- HUD NW case number

    -- Origination / org hierarchy
    loan_officer                NVARCHAR(256)   NULL,
    lo_nmls_id                  VARCHAR(32)     NULL,
    branch_nmls_id              VARCHAR(32)     NULL,
    hud_office                  VARCHAR(64)     NULL,
    hoc                         VARCHAR(32)     NULL,
    channel                     VARCHAR(16)     NULL,          -- Retail | Wholesale

    -- Program
    dpa_program                 VARCHAR(32)     NULL,          -- Boost | Arrive/Aurora | Non-DPA
    dpa_name                    NVARCHAR(128)   NULL,
    dpa_investor                NVARCHAR(128)   NULL,          -- new column as of Apr 2026
    investor_name               NVARCHAR(128)   NULL,
    loan_purpose                VARCHAR(32)     NULL,

    -- Borrower / loan characteristics
    fico_score                  SMALLINT        NULL,
    front_dti                   DECIMAL(9,4)    NULL,
    back_dti                    DECIMAL(9,4)    NULL,
    ltv                         DECIMAL(9,4)    NULL,
    loan_amount                 DECIMAL(14,2)   NULL,
    source_of_funds             VARCHAR(64)     NULL,
    employment_type             VARCHAR(64)     NULL,
    aus                         VARCHAR(16)     NULL,          -- DU | LP | Manual
    units                       TINYINT         NULL,
    property_type               VARCHAR(64)     NULL,
    occupancy                   VARCHAR(32)     NULL,

    -- HUD NW performance data
    delinquent_status_code      VARCHAR(16)     NULL,
    delinquent_status           VARCHAR(32)     NULL,          -- Current | 30 | 60 | 90+ | Claim
    months_delinquent           TINYINT         NULL,
    oldest_unpaid_installment   DATE            NULL,
    fha_ins_stat                VARCHAR(16)     NULL,

    -- Risk indicator flags (pre-computed by RPA)
    has_sub_620                 BIT             NOT NULL CONSTRAINT DF_loans_sub_620 DEFAULT 0,
    has_super_29_dti            BIT             NOT NULL CONSTRAINT DF_loans_super_29 DEFAULT 0,
    has_super_50_dti            BIT             NOT NULL CONSTRAINT DF_loans_super_50 DEFAULT 0,
    has_super_90_ltv            BIT             NOT NULL CONSTRAINT DF_loans_super_90 DEFAULT 0,
    has_super_95_ltv            BIT             NOT NULL CONSTRAINT DF_loans_super_95 DEFAULT 0,
    has_dpa                     BIT             NOT NULL CONSTRAINT DF_loans_dpa DEFAULT 0,
    has_manufactured            BIT             NOT NULL CONSTRAINT DF_loans_manufactured DEFAULT 0,
    has_variable_income         BIT             NOT NULL CONSTRAINT DF_loans_variable DEFAULT 0,
    has_super_variable_income   BIT             NOT NULL CONSTRAINT DF_loans_super_variable DEFAULT 0,
    has_non_owner_occupied      BIT             NOT NULL CONSTRAINT DF_loans_nonowner DEFAULT 0,
    has_manual_uw               BIT             NOT NULL CONSTRAINT DF_loans_manual_uw DEFAULT 0,
    has_hud_deficiency          BIT             NOT NULL CONSTRAINT DF_loans_hud_def DEFAULT 0,
    has_gift_grant              BIT             NOT NULL CONSTRAINT DF_loans_gift DEFAULT 0,
    risk_indicator_count        TINYINT         NOT NULL CONSTRAINT DF_loans_risk_cnt DEFAULT 0,

    -- Performance flags
    is_delinquent               BIT             NOT NULL CONSTRAINT DF_loans_is_dlq DEFAULT 0,
    is_seriously_delinquent     BIT             NOT NULL CONSTRAINT DF_loans_sdq DEFAULT 0,
    is_claim                    BIT             NOT NULL CONSTRAINT DF_loans_claim DEFAULT 0,

    CONSTRAINT PK_loans PRIMARY KEY CLUSTERED (snapshot_id, loan_id),
    CONSTRAINT FK_loans_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES fha.snapshots(snapshot_id) ON DELETE CASCADE,
    CONSTRAINT CK_loans_channel CHECK (channel IN (N'Retail', N'Wholesale') OR channel IS NULL),
    CONSTRAINT CK_loans_dpa_program CHECK (dpa_program IN (N'Boost', N'Arrive/Aurora', N'Non-DPA') OR dpa_program IS NULL),
    CONSTRAINT CK_loans_risk_count CHECK (risk_indicator_count BETWEEN 0 AND 13)
);
GO

-- Common filter patterns for the dashboard
CREATE INDEX IX_loans_lo
    ON fha.loans (snapshot_id, lo_nmls_id)
    INCLUDE (is_delinquent, is_seriously_delinquent, risk_indicator_count);
GO

CREATE INDEX IX_loans_hud_office
    ON fha.loans (snapshot_id, hud_office)
    INCLUDE (dpa_program, channel, is_delinquent);
GO

CREATE INDEX IX_loans_dpa
    ON fha.loans (snapshot_id, dpa_program, dpa_investor)
    INCLUDE (channel, is_delinquent);
GO

CREATE INDEX IX_loans_delinquent_only
    ON fha.loans (snapshot_id, is_delinquent)
    WHERE is_delinquent = 1;
GO


/* -----------------------------------------------------------------------------
   SEED — reference data (dimensions + known HUD offices → HOC)
   -----------------------------------------------------------------------------*/

-- Dimensions (UI metadata)
MERGE fha.dimensions AS tgt
USING (VALUES
    (N'dpa_program',            N'DPA Program',                 10,  N'bar'),
    (N'dpa_investor',           N'DPA Investor',                20,  N'bar'),
    (N'channel',                N'Channel',                     30,  N'bar'),
    (N'fico',                   N'FICO',                        40,  N'bar'),
    (N'front_dti',              N'Front-End DTI',               50,  N'bar'),
    (N'back_dti',               N'Back-End DTI',                60,  N'bar'),
    (N'ltv',                    N'LTV',                         70,  N'bar'),
    (N'investor',               N'Investor',                    80,  N'bar'),
    (N'hud_office',             N'HUD Office',                  90,  N'bar'),
    (N'source_of_funds',        N'Source of Funds',             100, N'bar'),
    (N'employment',             N'Employment Type',             110, N'bar'),
    (N'aus',                    N'Automated Underwriting',      120, N'bar'),
    (N'loan_purpose',           N'Loan Purpose',                130, N'bar'),
    (N'units',                  N'Units',                       140, N'bar'),
    (N'risk_indicator_count',   N'# of Risk Indicators',        150, N'heatmap')
) AS src (dimension_key, display_name, display_order, chart_type)
ON tgt.dimension_key = src.dimension_key
WHEN NOT MATCHED BY TARGET THEN
    INSERT (dimension_key, display_name, display_order, chart_type)
    VALUES (src.dimension_key, src.display_name, src.display_order, src.chart_type);
GO

-- HUD Offices → HOC mapping (canonical 4-HOC geography as of 2026)
MERGE fha.hud_offices AS tgt
USING (VALUES
    -- Atlanta HOC
    (N'Atlanta',        N'Atlanta',      N'GA'),
    (N'Birmingham',     N'Atlanta',      N'AL'),
    (N'Caribbean',      N'Atlanta',      NULL),
    (N'Columbia',       N'Atlanta',      N'SC'),
    (N'Coral Gables',   N'Atlanta',      N'FL'),
    (N'Greensboro',     N'Atlanta',      N'NC'),
    (N'Jackson',        N'Atlanta',      N'MS'),
    (N'Jacksonville',   N'Atlanta',      N'FL'),
    (N'Knoxville',      N'Atlanta',      N'TN'),
    (N'Louisville',     N'Atlanta',      N'KY'),
    (N'Memphis',        N'Atlanta',      N'TN'),
    (N'Miami',          N'Atlanta',      N'FL'),
    (N'Nashville',      N'Atlanta',      N'TN'),
    (N'Orlando',        N'Atlanta',      N'FL'),
    (N'San Juan',       N'Atlanta',      NULL),
    (N'Tampa',          N'Atlanta',      N'FL'),
    -- Denver HOC
    (N'Albuquerque',    N'Denver',       N'NM'),
    (N'Casper',         N'Denver',       N'WY'),
    (N'Dallas',         N'Denver',       N'TX'),
    (N'Denver',         N'Denver',       N'CO'),
    (N'Des Moines',     N'Denver',       N'IA'),
    (N'Fargo',          N'Denver',       N'ND'),
    (N'Fort Worth',     N'Denver',       N'TX'),
    (N'Helena',         N'Denver',       N'MT'),
    (N'Houston',        N'Denver',       N'TX'),
    (N'Kansas City',    N'Denver',       N'MO'),
    (N'Little Rock',    N'Denver',       N'AR'),
    (N'Lubbock',        N'Denver',       N'TX'),
    (N'Minneapolis',    N'Denver',       N'MN'),
    (N'New Orleans',    N'Denver',       N'LA'),
    (N'Oklahoma City',  N'Denver',       N'OK'),
    (N'Omaha',          N'Denver',       N'NE'),
    (N'Rapid City',     N'Denver',       N'SD'),
    (N'Salt Lake City', N'Denver',       N'UT'),
    (N'San Antonio',    N'Denver',       N'TX'),
    (N'Shreveport',     N'Denver',       N'LA'),
    (N'Sioux Falls',    N'Denver',       N'SD'),
    (N'Springfield',    N'Denver',       N'MO'),
    (N'St. Louis',      N'Denver',       N'MO'),
    (N'Tulsa',          N'Denver',       N'OK'),
    (N'Wichita',        N'Denver',       N'KS'),
    -- Philadelphia HOC
    (N'Albany',         N'Philadelphia', N'NY'),
    (N'Baltimore',      N'Philadelphia', N'MD'),
    (N'Bangor',         N'Philadelphia', N'ME'),
    (N'Boston',         N'Philadelphia', N'MA'),
    (N'Buffalo',        N'Philadelphia', N'NY'),
    (N'Burlington',     N'Philadelphia', N'VT'),
    (N'Charleston',     N'Philadelphia', N'WV'),
    (N'Charlotte',      N'Philadelphia', N'NC'),
    (N'Chicago',        N'Philadelphia', N'IL'),
    (N'Cincinnati',     N'Philadelphia', N'OH'),
    (N'Cleveland',      N'Philadelphia', N'OH'),
    (N'Columbus',       N'Philadelphia', N'OH'),
    (N'Detroit',        N'Philadelphia', N'MI'),
    (N'Flint',          N'Philadelphia', N'MI'),
    (N'Grand Rapids',   N'Philadelphia', N'MI'),
    (N'Hartford',       N'Philadelphia', N'CT'),
    (N'Indianapolis',   N'Philadelphia', N'IN'),
    (N'Manchester',     N'Philadelphia', N'NH'),
    (N'Milwaukee',      N'Philadelphia', N'WI'),
    (N'Newark',         N'Philadelphia', N'NJ'),
    (N'New York',       N'Philadelphia', N'NY'),
    (N'Philadelphia',   N'Philadelphia', N'PA'),
    (N'Pittsburgh',     N'Philadelphia', N'PA'),
    (N'Providence',     N'Philadelphia', N'RI'),
    (N'Richmond',       N'Philadelphia', N'VA'),
    (N'Washington, DC', N'Philadelphia', N'DC'),
    -- Santa Ana HOC
    (N'Anchorage',      N'Santa Ana',    N'AK'),
    (N'Boise',          N'Santa Ana',    N'ID'),
    (N'Fresno',         N'Santa Ana',    N'CA'),
    (N'Honolulu',       N'Santa Ana',    N'HI'),
    (N'Las Vegas',      N'Santa Ana',    N'NV'),
    (N'Los Angeles',    N'Santa Ana',    N'CA'),
    (N'Phoenix',        N'Santa Ana',    N'AZ'),
    (N'Portland',       N'Santa Ana',    N'OR'),
    (N'Reno',           N'Santa Ana',    N'NV'),
    (N'Sacramento',     N'Santa Ana',    N'CA'),
    (N'San Diego',      N'Santa Ana',    N'CA'),
    (N'San Francisco',  N'Santa Ana',    N'CA'),
    (N'Santa Ana',      N'Santa Ana',    N'CA'),
    (N'Seattle',        N'Santa Ana',    N'WA'),
    (N'Spokane',        N'Santa Ana',    N'WA'),
    (N'Tucson',         N'Santa Ana',    N'AZ')
) AS src (hud_office, hoc, state_code)
ON tgt.hud_office = src.hud_office
WHEN NOT MATCHED BY TARGET THEN
    INSERT (hud_office, hoc, state_code)
    VALUES (src.hud_office, src.hoc, src.state_code);
GO


/* -----------------------------------------------------------------------------
   VIEWS — convenience accessors for the dashboard
   -----------------------------------------------------------------------------*/

-- Latest completed snapshot id (for "current as-of" queries)
IF OBJECT_ID(N'fha.v_latest_snapshot', N'V') IS NOT NULL DROP VIEW fha.v_latest_snapshot;
GO
CREATE VIEW fha.v_latest_snapshot AS
    SELECT TOP (1)
        snapshot_id,
        performance_period,
        ingested_at
    FROM fha.snapshots
    WHERE status = N'complete'
    ORDER BY performance_period DESC, snapshot_id DESC;
GO


-- Top-line KPI tiles (Total / Retail / Sponsor compare ratios for a snapshot)
IF OBJECT_ID(N'fha.v_kpi_compare_ratios', N'V') IS NOT NULL DROP VIEW fha.v_kpi_compare_ratios;
GO
CREATE VIEW fha.v_kpi_compare_ratios AS
    SELECT
        s.snapshot_id,
        s.performance_period,
        MAX(CASE WHEN crt.scope = N'total'   THEN crt.compare_ratio END) AS total_ratio,
        MAX(CASE WHEN crt.scope = N'retail'  THEN crt.compare_ratio END) AS retail_ratio,
        MAX(CASE WHEN crt.scope = N'sponsor' THEN crt.compare_ratio END) AS sponsor_ratio,
        MAX(CASE WHEN crt.scope = N'total'   THEN crt.loans_count END)   AS total_loans,
        MAX(CASE WHEN crt.scope = N'total'   THEN crt.delinquent_count END) AS total_delinquent
    FROM fha.snapshots s
    INNER JOIN fha.compare_ratios_total crt ON crt.snapshot_id = s.snapshot_id
    GROUP BY s.snapshot_id, s.performance_period;
GO

/* =============================================================================
   END OF 001_initial_schema.sql
   =============================================================================*/
