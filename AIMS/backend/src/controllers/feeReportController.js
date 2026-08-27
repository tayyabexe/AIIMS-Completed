const feeReportService = require("../services/feeReportService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all reports
const getReports = async (req, res) => {
    try {

        const reports =
            await feeReportService.getAllReports();

        res.status(200).json({
            success: true,
            count: reports.length,
            data: reports
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Get report by ID
const getReport = async (req, res) => {
    try {

        const report =
            await feeReportService.getReportById(
                req.params.id
            );

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found"
            });
        }

        res.status(200).json({
            success: true,
            data: report
        });

    } catch (error) {

        sendError(res, error);

    }
};

module.exports = {
    getReports,
    getReport
};
