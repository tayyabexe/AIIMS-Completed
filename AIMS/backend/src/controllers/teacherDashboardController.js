const teacherDashboardService = require("../services/teacherDashboardService");

const getDashboard = async (req, res) => {
    try {

        const dashboard =
            await teacherDashboardService.getDashboard(
                req.params.id
            );

        if (!dashboard) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        res.status(200).json({
            success: true,
            data: dashboard
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

module.exports = {
    getDashboard
};