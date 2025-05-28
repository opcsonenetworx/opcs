// encoder_viewer.js - Backend logic for ViewingEncoder.html
// Handles data fetching from SheetDB and displays insurance policy data

// SheetDB API configuration
const SHEET_DB_API_URL = "https://sheetdb.io/api/v1/74fageuz0xvvu"; // Insurance policy SheetDB API endpoint

// Global state for the viewer
let currentData = [];
let filteredData = [];
let currentPage = 1;
const itemsPerPage = 10;
let linesOfBusiness = new Set();
let providers = new Set();

/**
 * Initialize the viewer functionality
 */
export async function initializeViewer() {
    console.log("Initializing insurance policy viewer...");
    
    // Setup event listeners for filters
    setupFilterListeners();
    
    // Setup export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
    
    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Load initial data
    await loadData();
    
    // Setup modal
    setupModal();
    
    // Setup network monitoring
    setupNetworkMonitoring();
    
    // Initialize cache refresh mechanism
    initializeCacheRefresh();
}

/**
 * Setup all event listeners for filter controls
 *Update the search input event listener to ensure it works correctly
 */
function setupFilterListeners() {
    // Date filter change event
    document.getElementById('dateFilter').addEventListener('change', function() {
        const customDateContainers = [
            document.getElementById('customDateContainer'),
            document.getElementById('customDateEndContainer')
        ];
        
        if (this.value === 'custom') {
            customDateContainers.forEach(container => container.style.display = 'block');
        } else {
            customDateContainers.forEach(container => container.style.display = 'none');
        }
    });
    
    // Apply filters button
    document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
    
    // Reset filters button
    document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
    
    // Retry button for no data scenario
    document.getElementById('retryBtn').addEventListener('click', loadData);
    
    // Search input (apply filter on keyup with debounce)
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;
    searchInput.addEventListener('keyup', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            applyFilters();
        }, 500);
    });
}

/**
 * Load data from SheetDB API
 */
async function loadData() {
    showLoadingSpinner(true);
    
    try {
        // Check if browser is online
        if (!navigator.onLine) {
            // Try to load from cache if offline
            const cachedData = localStorage.getItem('policyViewerData');
            if (cachedData) {
                processData(JSON.parse(cachedData));
                showConnectionStatus('Working in offline mode with cached data', 'warning');
                return;
            } else {
                throw new Error("You're offline and no cached data is available");
            }
        }
        
        // Fetch data from SheetDB with proper headers according to docs
        const response = await fetch(SHEET_DB_API_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            // Adding a timeout option using AbortController
            signal: AbortSignal.timeout(15000) // 15 second timeout
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`SheetDB API error (${response.status}): ${errorText || response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if response is valid - SheetDB returns an error object when something goes wrong
        if (data.error) {
            throw new Error(`SheetDB error: ${data.error}`);
        }
        
        // Check if data is an empty array or not an array at all
        if (!Array.isArray(data) || data.length === 0) {
            showNoDataMessage(true, "No policy data found in the SheetDB database");
            return;
        }
        
        // Save to local storage for offline access
        localStorage.setItem('policyViewerData', JSON.stringify(data));
        
        // Process the data
        processData(data);
        showConnectionStatus('Policy data loaded successfully', 'success');
        
    } catch (error) {
        console.error("Error loading policy data:", error);
        showNoDataMessage(true, error.message);
        showConnectionStatus(`Error: ${error.message}`, 'error');
    } finally {
        showLoadingSpinner(false);
    }
}

/**
 * Search data using SheetDB search API
 * @param {Object} searchParams - The search parameters
 */
async function searchData(searchParams) {
    showLoadingSpinner(true);
    
    try {
        // Check if browser is online
        if (!navigator.onLine) {
            throw new Error("You're offline. Cannot perform search.");
        }
        
        // Build query string for search API
        const queryParams = new URLSearchParams();
        
        // Add search parameters to query
        Object.entries(searchParams).forEach(([key, value]) => {
            if (value && value !== '') {
                queryParams.append(key, value);
            }
        });
        
        // Use SheetDB search API as per documentation
        const searchUrl = `${SHEET_DB_API_URL}/search?${queryParams.toString()}`;
        
        const response = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`SheetDB Search API error (${response.status}): ${errorText || response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if data is an empty array or not an array at all
        if (!Array.isArray(data) || data.length === 0) {
            showNoDataMessage(true, "No policies found matching your search criteria");
            return;
        }
        
        // Process the search results
        processData(data);
        showConnectionStatus(`Found ${data.length} matching policies`, 'success');
        
    } catch (error) {
        console.error("Error searching policy data:", error);
        showConnectionStatus(`Search error: ${error.message}`, 'error');
        
        // Fall back to client-side filtering of cached data
        const cachedData = localStorage.getItem('policyViewerData');
        if (cachedData) {
            processData(JSON.parse(cachedData));
            applyFilters(); // Apply client-side filters to the cached data
            showConnectionStatus('Using cached data for search (offline mode)', 'warning');
        } else {
            showNoDataMessage(true, "Cannot search: No cached data available");
        }
    } finally {
        showLoadingSpinner(false);
    }
}

/**
 * Process the data retrieved from SheetDB
 * @param {Array} data - The data from SheetDB
 */
function processData(data) {
    if (!data || data.length === 0) {
        showNoDataMessage(true, "No policy data found in the database");
        return;
    }
    
    // Store the data
    currentData = data;
    
    // Extract lines of business and providers for filter dropdowns
    linesOfBusiness.clear();
    providers.clear();
    
    data.forEach(item => {
        if (item['LINE OF BUSINESS']) {
            linesOfBusiness.add(item['LINE OF BUSINESS']);
        }
        if (item['PROVIDER']) {
            providers.add(item['PROVIDER']);
        }
    });
    
    // Populate filter dropdowns
    populateFilterDropdown('lobFilter', Array.from(linesOfBusiness));
    populateFilterDropdown('providerFilter', Array.from(providers));
    
    // Apply initial filters
    applyFilters();
    
    // Show the data table
    document.getElementById('dataTable').style.display = 'block';
    showNoDataMessage(false);
}

/**
 * Populate a filter dropdown with options
 * @param {string} elementId - The ID of the dropdown element
 * @param {Array} options - List of options to populate
 */
function populateFilterDropdown(elementId, options) {
    const dropdown = document.getElementById(elementId);
    
    if (!dropdown) return;
    
    // Clear existing options except the first one
    while (dropdown.options.length > 1) {
        dropdown.remove(1);
    }
    
    // Add options for each category
    options.sort().forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        dropdown.appendChild(optionElement);
    });
}

/**
 * Apply all filters to the data
 * Improved applyFilters function with better visibility control
 */
function applyFilters() {
    // Get filter values
    const dateFilter = document.getElementById('dateFilter').value;
    const lobFilter = document.getElementById('lobFilter')?.value || 'all';
    const providerFilter = document.getElementById('providerFilter')?.value || 'all';
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    let startDate, endDate;
    
    // Handle date filter
    if (dateFilter === 'custom') {
        startDate = document.getElementById('startDate').value;
        endDate = document.getElementById('endDate').value;
        
        if (startDate) startDate = new Date(startDate);
        if (endDate) {
            endDate = new Date(endDate);
            // Set to end of day
            endDate.setHours(23, 59, 59, 999);
        }
    } else {
        const dateBounds = getDateBoundsFromFilter(dateFilter);
        startDate = dateBounds.start;
        endDate = dateBounds.end;
    }
    
    // Apply filters
    filteredData = currentData.filter(item => {
        // Date filter - using ISSUE DATE as the primary date field
        if (startDate || endDate) {
            const itemDate = new Date(item['ISSUE DATE'] || item['INCEPTION DATE']);
            
            if (startDate && itemDate < startDate) return false;
            if (endDate && itemDate > endDate) return false;
        }
        
        // Line of business filter
        if (lobFilter !== 'all' && item['LINE OF BUSINESS'] !== lobFilter) {
            return false;
        }
        
        // Provider filter
        if (providerFilter !== 'all' && item['PROVIDER'] !== providerFilter) {
            return false;
        }
        
        // Search filter - search across all fields
        if (searchTerm) {
            const itemValues = Object.values(item).join(' ').toLowerCase();
            if (!itemValues.includes(searchTerm)) {
                return false;
            }
        }
        
        return true;
    });
    
    // Reset to first page and render
    currentPage = 1;
    
    // Check if we have data after filtering
    if (filteredData.length === 0) {
        // No data matched our filters
        showNoDataMessage(true, "No policies match your filter criteria");
        document.getElementById('dataTable').style.display = 'none';
    } else {
        // We have data, render the table
        renderTable();
    }
    
    // Show filter results count
    const resultCount = document.getElementById('resultCount');
    if (resultCount) {
        resultCount.textContent = `${filteredData.length} policies found`;
    }
}


/**
 * Reset all filters to default values
 * Updated reset filters to explicitly show the data table
 */
function resetFilters() {
    document.getElementById('dateFilter').value = 'all';
    if (document.getElementById('lobFilter')) {
        document.getElementById('lobFilter').value = 'all';
    }
    if (document.getElementById('providerFilter')) {
        document.getElementById('providerFilter').value = 'all';
    }
    document.getElementById('searchInput').value = '';
    document.getElementById('customDateContainer').style.display = 'none';
    document.getElementById('customDateEndContainer').style.display = 'none';
    
    // Ensure the table can be shown
    showNoDataMessage(false);
    
    // Apply the reset filters
    applyFilters();
}

/**
 * Convert date filter to actual date bounds
 * @param {string} filter - The date filter value
 * @returns {Object} - Object with start and end dates
 */
function getDateBoundsFromFilter(filter) {
    const now = new Date();
    let start = null;
    let end = new Date(now);
    
    // Set to end of day
    end.setHours(23, 59, 59, 999);
    
    switch (filter) {
        case 'today':
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            break;
            
        case 'yesterday':
            start = new Date(now);
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end = new Date(start);
            end.setHours(23, 59, 59, 999);
            break;
            
        case 'thisWeek':
            start = new Date(now);
            start.setDate(start.getDate() - start.getDay());
            start.setHours(0, 0, 0, 0);
            break;
            
        case 'lastWeek':
            start = new Date(now);
            start.setDate(start.getDate() - start.getDay() - 7);
            start.setHours(0, 0, 0, 0);
            end = new Date(start);
            end.setDate(end.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            break;
            
        case 'thisMonth':
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            break;
            
        case 'all':
        default:
            start = null;
            end = null;
    }
    
    return { start, end };
}

/**
 * Render the data table with current filters and pagination
 * showing only important policy details
 * Updated renderTable function to correctly handle data display transitions
 */
function renderTable() {
    const tableHeader = document.getElementById('tableHeader');
    const tableBody = document.getElementById('tableBody');
    const dataTable = document.getElementById('dataTable');
    
    // Clear existing content
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    
    // If no data after filtering
    if (filteredData.length === 0) {
        dataTable.style.display = 'none'; // Hide the table
        showNoDataMessage(true, "No policies match your filter criteria");
        return;
    } else {
        dataTable.style.display = 'block'; // Make sure table is visible
        showNoDataMessage(false);
    }
    
    // Define only the most important fields to display in main table
    // This creates a more focused view with only essential information
    const displayHeaders = [
        { field: 'POLICY NUMBER', display: 'Policy No.', priority: true },
        { field: 'ASSURED NAME', display: 'Assured Name', priority: true },
        { field: 'LINE OF BUSINESS', display: 'Line of Business', priority: true },
        { field: 'PROVIDER', display: 'Provider', priority: false },
        { field: 'EXPIRY DATE', display: 'Expiry Date', priority: true },
        { field: 'GROSS PREMIUM/TOTAL AMOUNT DUE', display: 'Premium', priority: true }
    ];
    
    // Create table headers with emphasized priority headers
    displayHeaders.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.display;
        
        // Add special styling to priority headers
        if (header.priority) {
            th.style.fontWeight = 'bold';
            th.style.backgroundColor = '#f0f8ff'; // Light blue background
            th.style.position = 'relative';
            
            // Add a small indicator dot to show this is an important field
            const indicator = document.createElement('span');
            indicator.innerHTML = '•';
            indicator.style.color = '#0275d8';
            indicator.style.marginLeft = '3px';
            indicator.style.fontSize = '14px';
            indicator.title = 'Important field';
            th.appendChild(indicator);
        }
        
        tableHeader.appendChild(th);
    });
    
    // Add actions column
    const actionsHeader = document.createElement('th');
    actionsHeader.textContent = 'Actions';
    tableHeader.appendChild(actionsHeader);
    
    // Calculate pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredData.length);
    const pageData = filteredData.slice(startIndex, endIndex);
    
    // Create table rows with enhanced important information
    pageData.forEach(item => {
        const row = document.createElement('tr');
        
        // Add each cell with enhanced styling for priority fields
        displayHeaders.forEach(header => {
            const cell = document.createElement('td');
            
            // Format date fields
            if (header.field.includes('DATE')) {
                if (item[header.field]) {
                    const date = new Date(item[header.field]);
                    cell.textContent = isNaN(date.getTime()) ? item[header.field] : date.toLocaleDateString();
                    
                    // Check if expiration date is approaching (within 30 days)
                    if (header.field === 'EXPIRY DATE' && !isNaN(date.getTime())) {
                        const daysToExpiry = Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
                        
                        if (daysToExpiry <= 0) {
                            // Expired
                            cell.style.color = '#dc3545'; // Red
                            cell.style.fontWeight = 'bold';
                            cell.title = 'Expired';
                        } else if (daysToExpiry <= 30) {
                            // Expiring soon
                            cell.style.color = '#fd7e14'; // Orange
                            cell.style.fontWeight = 'bold';
                            cell.title = `Expires in ${daysToExpiry} days`;
                        }
                    }
                } else {
                    cell.textContent = 'N/A';
                }
            }
            // Format premium/monetary fields
            else if (header.field.includes('PREMIUM') || header.field.includes('AMOUNT')) {
                const value = item[header.field];
                if (value) {
                    // Convert to number if possible and format
                    const numericValue = parseFloat(value.toString().replace(/[^\d.-]/g, ''));
                    if (!isNaN(numericValue)) {
                        cell.textContent = new Intl.NumberFormat('en-PH', { 
                            style: 'currency', 
                            currency: 'PHP' 
                        }).format(numericValue);
                        
                        // Highlight high value premiums
                        if (header.field === 'GROSS PREMIUM/TOTAL AMOUNT DUE' && numericValue > 50000) {
                            cell.style.color = '#28a745'; // Green for high-value policies
                            cell.style.fontWeight = 'bold';
                        }
                    } else {
                        cell.textContent = value;
                    }
                } else {
                    cell.textContent = 'N/A';
                }
            }
            else {
                cell.textContent = item[header.field] || 'N/A';
            }
            
            // Apply special styling for priority fields
            if (header.priority) {
                cell.style.backgroundColor = '#f8f9fa'; // Light gray background
                cell.style.fontWeight = header.field === 'POLICY NUMBER' || header.field === 'ASSURED NAME' ? 'bold' : 'normal';
            }
            
            row.appendChild(cell);
        });
        
        // Add actions cell with enhanced view button
        const actionsCell = document.createElement('td');
        
        // Create the view details button
        const viewBtn = document.createElement('button');
        viewBtn.textContent = 'View Details';
        viewBtn.className = 'btn btn-primary btn-sm';
        viewBtn.addEventListener('click', () => showDetailModal(item));
        
        actionsCell.appendChild(viewBtn);
        
        row.appendChild(actionsCell);
        
        // Add status indicator for expiring policies
        const expiryDate = item['EXPIRY DATE'] ? new Date(item['EXPIRY DATE']) : null;
        if (expiryDate && !isNaN(expiryDate.getTime())) {
            const daysToExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            
            if (daysToExpiry <= 0) {
                row.style.borderLeft = '4px solid #dc3545'; // Red border for expired
                row.title = 'Policy expired';
            } else if (daysToExpiry <= 30) {
                row.style.borderLeft = '4px solid #fd7e14'; // Orange border for expiring soon
                row.title = `Policy expires in ${daysToExpiry} days`;
            }
        }
        
        // Add the row to the table body
        tableBody.appendChild(row);
    });
    
    // Render pagination
    renderPagination();
}

/**
 * Render the pagination controls
 */
function renderPagination() {
    const paginationContainer = document.getElementById('pagination');
    paginationContainer.innerHTML = '';
    
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    
    if (totalPages <= 1) {
        return; // No need for pagination
    }
    
    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '«';
    prevBtn.className = 'page-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });
    paginationContainer.appendChild(prevBtn);
    
    // Page buttons
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // Adjust start page if we're near the end
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // First page button if not visible
    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.textContent = '1';
        firstBtn.className = 'page-btn';
        firstBtn.addEventListener('click', () => {
            currentPage = 1;
            renderTable();
        });
        paginationContainer.appendChild(firstBtn);
        
        // Ellipsis if needed
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.className = 'page-btn';
            ellipsis.style.cursor = 'default';
            paginationContainer.appendChild(ellipsis);
        }
    }
    
    // Visible page buttons
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.className = 'page-btn';
        if (i === currentPage) {
            pageBtn.classList.add('active');
        }
        pageBtn.addEventListener('click', () => {
            currentPage = i;
            renderTable();
        });
        paginationContainer.appendChild(pageBtn);
    }
    
    // Last page button if not visible
    if (endPage < totalPages) {
        // Ellipsis if needed
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.className = 'page-btn';
            ellipsis.style.cursor = 'default';
            paginationContainer.appendChild(ellipsis);
        }
        
        const lastBtn = document.createElement('button');
        lastBtn.textContent = totalPages;
        lastBtn.className = 'page-btn';
        lastBtn.addEventListener('click', () => {
            currentPage = totalPages;
            renderTable();
        });
        paginationContainer.appendChild(lastBtn);
    }
    
    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '»';
    nextBtn.className = 'page-btn';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });
    paginationContainer.appendChild(nextBtn);
}

/**
 * Show or hide the loading spinner
 * @param {boolean} show - Whether to show the spinner
 */
function showLoadingSpinner(show) {
    document.getElementById('loadingSpinner').style.display = show ? 'flex' : 'none';
    document.getElementById('dataTable').style.display = show ? 'none' : 'block';
}

/**
 * Show or hide the no data message
 * @param {boolean} show - Whether to show the message
 * @param {string} message - Custom message to display
 * Updated showNoDataMessage function to better handle display state
 */ 
function showNoDataMessage(show, message = null) {
    const noDataElement = document.getElementById('noDataMessage');
    const dataTable = document.getElementById('dataTable');
    
    if (show) {
        dataTable.style.display = 'none';
        noDataElement.style.display = 'block';
        
        if (message) {
            const messageElement = noDataElement.querySelector('p');
            if (messageElement) {
                messageElement.textContent = message;
            }
        }
    } else {
        noDataElement.style.display = 'none';
        // Do not set dataTable display here, it's handled in renderTable
    }
}

/**
 * Show connection status message
 * @param {string} message - The message to display
 * @param {string} type - Message type: 'success', 'error', or 'warning'
 */
function showConnectionStatus(message, type = 'success') {
    const statusBar = document.getElementById('connection-status');
    
    // Set background color based on type
    switch (type) {
        case 'error':
            statusBar.style.backgroundColor = '#f8d7da';
            statusBar.style.color = '#721c24';
            break;
        case 'warning':
            statusBar.style.backgroundColor = '#fff3cd';
            statusBar.style.color = '#856404';
            break;
        case 'success':
        default:
            statusBar.style.backgroundColor = '#d4edda';
            statusBar.style.color = '#155724';
            break;
    }
    
    statusBar.style.height = 'auto';
    statusBar.style.padding = '4px 15px';
    statusBar.style.opacity = '1';
    statusBar.textContent = message;
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusBar.style.opacity = '0';
            setTimeout(() => {
                statusBar.style.height = '0';
                statusBar.style.padding = '0';
            }, 300);
        }, 3000);
    }
}

/**
 * Setup the detail modal functionality
 */
function setupModal() {
    const modal = document.getElementById('detailModal');
    if (!modal) return;
    
    const closeBtn = modal.querySelector('.close');
    const closeModalBtn = document.getElementById('closeModalBtn');
    
    // Close when clicking X
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
        });
    }
    
    // Close when clicking Close button
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            modal.classList.remove('show');
        });
    }
    
    // Close when clicking outside the modal
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.classList.remove('show');
        }
    });
}

/**
 * Show the detail modal with comprehensive item details
 * @param {Object} item - The data item to display
 */
function showDetailModal(item) {
    const modal = document.getElementById('detailModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    
    // Set modal title - use policy number and assured name
    const policyNumber = item['POLICY NUMBER'] || 'N/A';
    const assuredName = item['ASSURED NAME'] || '';
    modalTitle.textContent = `Policy ${policyNumber} - ${assuredName}`;
    
    // Clear existing content
    modalContent.innerHTML = '';
    
    // Create a more structured modal layout with categories
    const modalContainer = document.createElement('div');
    modalContainer.className = 'modal-detail-container';
    
    // Create sections for different categories of information
    const sections = [
        {
            title: 'Policy Information',
            icon: '📋',
            fields: [
                'POLICY NUMBER', 
                'LINE OF BUSINESS',
                'PROVIDER',
                'ENDORSEMENT NUMBER'
            ]
        },
        {
            title: 'Assured Information',
            icon: '👤',
            fields: [
                'ASSURED NAME',
                'CLIENT CONTACT NUMBER',
                'CLIENT EMAIL ADDRESS'
            ]
        },
        {
            title: 'Coverage Details',
            icon: '🛡️',
            fields: [
                'ISSUE DATE',
                'INCEPTION DATE',
                'EXPIRY DATE',
                'PROPERTY/UNIT INSURED',
                'PLATE NUMBER',
                'MORTGAGEE'
            ]
        },
        {
            title: 'Financial Details',
            icon: '💰',
            fields: [
                'GROSS PREMIUM/TOTAL AMOUNT DUE',
                'OD/THEFT/FL/SUM INSURED',
                'TAXES PAYMENT',
                'PF',
                'AON',
                'BI',
                'PD',
                'PA',
                'OTHERS'
            ]
        },
        {
            title: 'Handler Information',
            icon: '🤝',
            fields: [
                'EMPLOYEE HANDLER',
                'NAME OF AGENT/SUB-AGENT'
            ]
        }
    ];
    
    // Create each section
    sections.forEach(section => {
        // Check if any fields in this section have data
        const hasData = section.fields.some(field => item[field] !== undefined && item[field] !== '');
        if (!hasData) return; // Skip sections with no data
        
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'detail-section';
        
        // Create section header
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'detail-section-header';
        sectionHeader.innerHTML = `${section.icon} <span>${section.title}</span>`;
        sectionDiv.appendChild(sectionHeader);
        
        // Add fields for this section
        section.fields.forEach(field => {
            if (item[field] !== undefined && item[field] !== '') {
                addDetailRow(sectionDiv, field, item[field]);
            }
        });
        
        modalContainer.appendChild(sectionDiv);
    });
    
    // Add policy status indicator
    if (item['EXPIRY DATE']) {
        const expiryDate = new Date(item['EXPIRY DATE']);
        if (!isNaN(expiryDate.getTime())) {
            const daysToExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            
            const statusDiv = document.createElement('div');
            statusDiv.className = 'policy-status';
            
            if (daysToExpiry <= 0) {
                statusDiv.innerHTML = `<span class="status-indicator expired">⚠️ EXPIRED</span> This policy expired on ${formatDate(item['EXPIRY DATE'])}`;
                statusDiv.style.color = '#dc3545';
            } else if (daysToExpiry <= 30) {
                statusDiv.innerHTML = `<span class="status-indicator expiring">⚠️ EXPIRING SOON</span> This policy will expire in ${daysToExpiry} days (${formatDate(item['EXPIRY DATE'])})`;
                statusDiv.style.color = '#fd7e14';
            } else {
                statusDiv.innerHTML = `<span class="status-indicator active">✅ ACTIVE</span> This policy is active until ${formatDate(item['EXPIRY DATE'])}`;
                statusDiv.style.color = '#28a745';
            }
            
            // Insert status at the top
            modalContainer.insertBefore(statusDiv, modalContainer.firstChild);
        }
    }
    
    // Add contact actions if contact info exists
    if (item['CLIENT CONTACT NUMBER'] || item['CLIENT EMAIL ADDRESS']) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'contact-actions';
        
        if (item['CLIENT CONTACT NUMBER']) {
            const callBtn = document.createElement('a');
            callBtn.href = `tel:${item['CLIENT CONTACT NUMBER']}`;
            callBtn.className = 'btn btn-outline-primary btn-sm';
            callBtn.innerHTML = '📞 Call Client';
            actionsDiv.appendChild(callBtn);
        }
        
        if (item['CLIENT EMAIL ADDRESS']) {
            const emailBtn = document.createElement('a');
            emailBtn.href = `mailto:${item['CLIENT EMAIL ADDRESS']}`;
            emailBtn.className = 'btn btn-outline-primary btn-sm';
            emailBtn.innerHTML = '✉️ Email Client';
            actionsDiv.appendChild(emailBtn);
        }
        
        modalContainer.appendChild(actionsDiv);
    }
    
    // Add the container to the modal content
    modalContent.appendChild(modalContainer);
    
    // Add CSS for detailed modal layout
    addModalStyles();
    
    // Show the modal
    modal.classList.add('show');
}

/**
 * Add styles for enhanced modal display
 */
function addModalStyles() {
    if (document.getElementById('enhanced-modal-styles')) return;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'enhanced-modal-styles';
    styleElement.textContent = `
        .modal-detail-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .detail-section {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .detail-section-header {
            background-color: #f8f9fa;
            padding: 10px 15px;
            font-weight: bold;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .detail-row {
            display: flex;
            padding: 8px 15px;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .detail-row:last-child {
            border-bottom: none;
        }
        
        .detail-label {
            flex: 0 0 40%;
            font-weight: 500;
            color: #555;
        }
        
        .detail-value {
            flex: 0 0 60%;
        }
        
        .policy-status {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 10px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .status-indicator {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 15px;
            font-weight: bold;
            font-size: 12px;
            text-transform: uppercase;
        }
        
        .status-indicator.active {
            background-color: #d4edda;
            color: #155724;
        }
        
        .status-indicator.expiring {
            background-color: #fff3cd;
            color: #856404;
        }
        
        .status-indicator.expired {
            background-color: #f8d7da;
            color: #721c24;
        }
        
        .contact-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding-top: 15px;
            border-top: 1px solid #e0e0e0;
        }
    `;
    
    document.head.appendChild(styleElement);
}

/**
 * Add a detail row to the modal content
 * @param {HTMLElement} container - The container element
 * @param {string} fieldName - The field name
 * @param {any} value - The field value
 */
function addDetailRow(container, fieldName, value) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    
    const label = document.createElement('div');
    label.className = 'detail-label';
    label.textContent = fieldName;
    
    const valueElement = document.createElement('div');
    valueElement.className = 'detail-value';
    
    // Format specific field types
    if (fieldName.includes('DATE')) {
        valueElement.textContent = formatDate(value);
    } else if (fieldName.includes('PREMIUM') || fieldName.includes('AMOUNT') || 
               fieldName.includes('SUM INSURED') || fieldName === 'PF' || 
               fieldName === 'AON' || fieldName === 'BI' || 
               fieldName === 'PD' || fieldName === 'PA' || 
               fieldName === 'OTHERS') {
        valueElement.textContent = formatCurrency(value);
    } else {
        valueElement.textContent = value || 'N/A';
    }
    
    row.appendChild(label);
    row.appendChild(valueElement);
    container.appendChild(row);
}

/**
 * Format a date for display
 * @param {string|Date} dateValue - The date to format
 * @returns {string} - Formatted date string
 */
function formatDate(dateValue) {
    if (!dateValue) return 'N/A';
    
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return dateValue;
        
        return date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        return dateValue;
    }
}

/**
 * Format a currency value for display
 * @param {string|number} value - The value to format
 * @returns {string} - Formatted currency string
 */
function formatCurrency(value) {
    if (!value) return 'PHP 0.00';
    
    try {
        // Extract numeric value if it's a string with currency symbols
        const numericValue = typeof value === 'string' 
            ? parseFloat(value.replace(/[^\d.-]/g, '')) 
            : value;
            
        if (isNaN(numericValue)) return value;
        
        return new Intl.NumberFormat('en-PH', { 
            style: 'currency', 
            currency: 'PHP' 
        }).format(numericValue);
    } catch (error) {
        return value;
    }
}

/**
 * Export filtered data to CSV
 */
function exportToCSV() {
    if (filteredData.length === 0) {
        showConnectionStatus('No data to export', 'warning');
        return;
    }
    
    try {
        // Define the fields to include in the export (same as display headers)
        const fieldsToExport = [
            'ISSUE DATE', 'LINE OF BUSINESS', 'MORTGAGEE', 'ASSURED NAME', 
            'POLICY NUMBER', 'PROVIDER', 'ENDORSEMENT NUMBER', 'INCEPTION DATE', 
            'EXPIRY DATE', 'PLATE NUMBER', 'PROPERTY/UNIT INSURED', 'PF', 
            'OD/THEFT/FL/SUM INSURED', 'AON', 'BI', 'PD', 'PA', 'OTHERS', 
            'GROSS PREMIUM/TOTAL AMOUNT DUE', 'TAXES PAYMENT', 'EMPLOYEE HANDLER', 
            'NAME OF AGENT/SUB-AGENT', 'CLIENT CONTACT NUMBER', 'CLIENT EMAIL ADDRESS'
        ];
        
        // Create header row
        let csvContent = fieldsToExport.join(',') + '\n';
        
        // Add data rows
        filteredData.forEach(item => {
            const row = fieldsToExport.map(field => {
                let value = item[field] || '';
                
                // Format dates
                if (field.includes('DATE') && value) {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        value = date.toLocaleDateString('en-PH');
                    }
                }
                
                // Escape commas and quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                
                return value;
            }).join(',');
            
            csvContent += row + '\n';
        });
        
        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `insurance_policies_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showConnectionStatus('Export successful', 'success');
    } catch (error) {
        console.error("Error exporting data:", error);
        showConnectionStatus(`Export failed: ${error.message}`, 'error');
    }
}

/**
 * Setup network monitoring to detect online/offline status
 */
function setupNetworkMonitoring() {
    // Listen for online status changes
    window.addEventListener('online', () => {
        showConnectionStatus('Back online. Refreshing data...', 'success');
        loadData(); // Reload data when connection is restored
    });
    
    // Listen for offline status changes
    window.addEventListener('offline', () => {
        const cachedData = localStorage.getItem('policyViewerData');
        if (cachedData) {
            showConnectionStatus('Working offline with cached data', 'warning');
        } else {
            showConnectionStatus('You are offline. No cached data available.', 'error');
        }
    });
}

/**
 * Initialize cache refresh mechanism
 * This periodically refreshes the data cache when online
 */
function initializeCacheRefresh() {
    // Check if cache exists and get timestamp
    const cacheTimestamp = localStorage.getItem('policyViewerDataTimestamp');
    const now = new Date().getTime();
    
    // If cache is older than 24 hours and we're online, refresh it
    if ((!cacheTimestamp || (now - parseInt(cacheTimestamp)) > 24 * 60 * 60 * 1000) && navigator.onLine) {
        loadData();
    }
    
    // Set up periodic cache refresh (every 30 minutes when tab is active)
    setInterval(() => {
        if (navigator.onLine && document.visibilityState === 'visible') {
            loadData();
        }
    }, 30 * 60 * 1000);
    
    // Update cache timestamp when data is saved
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
        if (key === 'policyViewerData') {
            originalSetItem.call(this, 'policyViewerDataTimestamp', new Date().getTime());
        }
        originalSetItem.call(this, key, value);
    };
}

/**
 * Handle user logout process
 * Clears session data and redirects to login page
 */
function handleLogout() {
    console.log("Processing logout...");
    
    // Clear session storage
    sessionStorage.removeItem('userSession');
    
    // Clear any auth-related cookies
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    
    // Clear cached policy data but keep the actual policy data for offline use
    localStorage.removeItem('userCredentials');
    
    // Show logout message
    showConnectionStatus('Logged out successfully. Redirecting...', 'success');
    
    // Redirect to login page after a short delay
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1500);
}