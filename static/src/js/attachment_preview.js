/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useService } from "@web/core/utils/hooks";

export class AttachmentPreview extends Component {
    static template = "ultimate_attachment.AttachmentPreview";

    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.orm = useService("orm");

        this.fileInputRef = useRef("fileInput");
        
        this.state = useState({
            preview: null,
            attachments: [],
            loading: true,
        });

        onMounted(async () => {
            try {
                await this.loadAttachments();
            } finally {
                this.state.loading = false;
            }
        });
    }
    
    openFilePicker() {
        if (!this.props.record.resId) {
            alert(
                "Silakan simpan record terlebih dahulu sebelum mengunggah attachment."
            );
            return;
        }
    
        this.fileInputRef.el.click();
    }
    
    async loadAttachments() {
        if (!this.props.record.resId) {
            return;
        }

        this.state.attachments = await this.orm.searchRead(
            "ir.attachment",
            [
                ["res_model", "=", this.props.record.resModel],
                ["res_id", "=", this.props.record.resId],
            ],
            [
                "id",
                "name",
                "mimetype",
            ],
            {
                order: "id asc",
            }
        );
    }

    isImage(attachment) {
        return attachment.mimetype?.startsWith("image/");
    }

    isPdf(attachment) {
        return attachment.mimetype === "application/pdf";
    }

    getUrl(attachment) {
        return `/web/content/${attachment.id}?download=false`;
    }

    preview(attachment) {
        this.state.preview = attachment;
    }

    closePreview() {
        this.state.preview = null;
    }

    async resizeImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.85) {
        if (!file.type.startsWith("image/")) {
            return file;
        }
        
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
    
            img.onload = () => resolve(img);
            img.onerror = reject;
    
            img.src = URL.createObjectURL(file);
        });
    
        let width = image.width;
        let height = image.height;
    
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(
                maxWidth / width,
                maxHeight / height
            );
    
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }
    
        const canvas = document.createElement("canvas");
    
        canvas.width = width;
        canvas.height = height;
    
        const ctx = canvas.getContext("2d");
    
        ctx.drawImage(
            image,
            0,
            0,
            width,
            height
        );
    
        URL.revokeObjectURL(image.src);
    
        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => resolve(blob),
                "image/jpeg",
                quality
            );
        });
    }
    
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                resolve(reader.result.split(",")[1]);
            };

            reader.onerror = reject;

            reader.readAsDataURL(file);
        });
    }
    
    async onFileChange(ev) {
        const files = Array.from(ev.target.files);
    
        if (!files.length) {
            return;
        }

        // Cek apakah record sudah disimpan
        if (!this.props.record.resId) {
            alert("Silakan simpan record terlebih dahulu sebelum mengunggah attachment.");
            ev.target.value = "";
            return;
        }
        
        this.state.loading = true;

        try {
            for (const file of files) {
                const resizedFile = await this.resizeImage(file);
                const base64 = await this.fileToBase64(resizedFile);
        
                const attachmentIds = await this.orm.create(
                    "ir.attachment",
                    [{
                        name: file.name,
                        datas: base64,
                        mimetype: file.type || "application/octet-stream",
                        res_model: this.props.record.resModel,
                        res_id: this.props.record.resId,
                    }]
                );
        
                const attachmentId = attachmentIds[0];
        
                await this.orm.write(
                    this.props.record.resModel,
                    [this.props.record.resId],
                    {
                        [this.props.name]: [[4, attachmentId]],
                    }
                );
            }
        
            await this.loadAttachments();
        } finally {
            this.state.loading = false;
            ev.target.value = "";
        }
    }

    async removeAttachment(attachment) {
        const confirmed = window.confirm(
            `Apakah Anda yakin ingin menghapus file "${attachment.name}"?`
        );
    
        if (!confirmed) {
            return;
        }
        
        const attachmentId = attachment.id;
        
        if (!attachmentId) {
            return;
        }

        this.state.loading = true;

        try {
            // Hapus relasi Many2many
            await this.orm.write(
                this.props.record.resModel,
                [this.props.record.resId],
                {
                    [this.props.name]: [[3, attachmentId]],
                }
            );
        
            // Hapus record ir.attachment
            await this.orm.unlink(
                "ir.attachment",
                [attachmentId]
            );
        
            // Refresh field
            await this.loadAttachments();
        
            // Tutup preview jika sedang dibuka
            if (
                this.state.preview &&
                Number(this.state.preview.id) === attachmentId
            ) {
                this.closePreview();
            }
        } finally {
            this.state.loading = false;
        }
    }
    
}

registry.category("fields").add("ua_preview", {
    component: AttachmentPreview,
    supportedTypes: ["many2many"],
});